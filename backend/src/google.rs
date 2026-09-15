//! Google OAuth authorization-code exchange and ID-token verification.

use anyhow::{anyhow, Context, Result};
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use reqwest::header::CACHE_CONTROL;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

const JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const DEFAULT_JWKS_TTL: Duration = Duration::from_secs(3600);

#[derive(Debug)]
struct CachedJwks {
    set: JwkSet,
    expires_at: Instant,
}

/// Claims carried by a Google OpenID Connect ID token.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GoogleIdToken {
    /// Stable Google account identifier.
    pub sub: String,
    /// Google account email address.
    pub email: String,
    /// Whether Google verified ownership of the email address.
    pub email_verified: bool,
    /// Token audience (one of the configured OAuth client IDs).
    pub aud: String,
    /// Token issuer.
    pub iss: String,
    /// Expiration time.
    pub exp: usize,
    /// Optional display name.
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    id_token: String,
}

/// Google verifier with a process-local, HTTP-cache-aware JWKS cache.
#[derive(Clone)]
pub struct GoogleVerifier {
    client: reqwest::Client,
    client_ids: Vec<String>,
    client_secret: Option<String>,
    client_secret_client_id: Option<String>,
    jwks: std::sync::Arc<RwLock<Option<CachedJwks>>>,
}

impl GoogleVerifier {
    /// Creates a verifier for the configured OAuth client IDs and optional
    /// client-secret pairing.
    pub fn new(
        client_ids: Vec<String>,
        client_secret: Option<String>,
        client_secret_client_id: Option<String>,
    ) -> Self {
        Self {
            client: reqwest::Client::new(),
            client_ids,
            client_secret,
            client_secret_client_id,
            jwks: std::sync::Arc::new(RwLock::new(None)),
        }
    }

    /// Returns the configured client IDs.
    pub fn client_ids(&self) -> &[String] {
        &self.client_ids
    }

    async fn fetch_jwks(&self) -> Result<CachedJwks> {
        let response = self.client.get(JWKS_URL).send().await?.error_for_status()?;
        let ttl = response
            .headers()
            .get(CACHE_CONTROL)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| {
                value.split(',').find_map(|part| {
                    part.trim()
                        .strip_prefix("max-age=")
                        .and_then(|seconds| seconds.parse::<u64>().ok())
                })
            })
            .map(Duration::from_secs)
            .unwrap_or(DEFAULT_JWKS_TTL);
        let set = response
            .json::<JwkSet>()
            .await
            .context("invalid Google JWKS")?;
        Ok(CachedJwks {
            set,
            expires_at: Instant::now() + ttl,
        })
    }

    async fn jwk_for(&self, kid: &str) -> Result<jsonwebtoken::jwk::Jwk> {
        {
            let cache = self.jwks.read().await;
            if let Some(cached) = cache
                .as_ref()
                .filter(|cached| cached.expires_at > Instant::now())
            {
                if let Some(jwk) = cached.set.find(kid) {
                    return Ok(jwk.clone());
                }
            }
        }

        let fetched = self.fetch_jwks().await?;
        let key = fetched
            .set
            .find(kid)
            .cloned()
            .ok_or_else(|| anyhow!("Google signing key not found"))?;
        *self.jwks.write().await = Some(fetched);
        Ok(key)
    }

    /// Exchanges a PKCE authorization code for its Google ID token.
    pub async fn exchange_code(
        &self,
        code: &str,
        code_verifier: &str,
        redirect_uri: &str,
        client_id: &str,
    ) -> Result<String> {
        if !self.client_ids.iter().any(|id| id == client_id) {
            return Err(anyhow!("Google client ID is not configured"));
        }
        let form = token_exchange_params(
            code,
            code_verifier,
            redirect_uri,
            client_id,
            client_secret_for(
                self.client_secret.as_deref(),
                self.client_secret_client_id.as_deref(),
                client_id,
            ),
        );
        let response = self
            .client
            .post(TOKEN_URL)
            .form(&form)
            .send()
            .await?
            .error_for_status()
            .context("Google authorization-code exchange failed")?
            .json::<TokenResponse>()
            .await
            .context("Google token response did not contain an ID token")?;
        Ok(response.id_token)
    }

    /// Verifies a Google ID token signature, issuer, audience, expiry and email.
    pub async fn verify_id_token(&self, token: &str) -> Result<GoogleIdToken> {
        let header = decode_header(token).context("invalid Google ID-token header")?;
        if header.alg != Algorithm::RS256 {
            return Err(anyhow!("Google ID token is not RS256"));
        }
        let kid = header
            .kid
            .ok_or_else(|| anyhow!("Google ID token has no key ID"))?;
        let jwk = self.jwk_for(&kid).await?;
        let key = DecodingKey::from_jwk(&jwk).context("invalid Google signing key")?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&self.client_ids);
        validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        let claims = decode::<GoogleIdToken>(token, &key, &validation)
            .context("Google ID token failed validation")?
            .claims;
        if !claims.email_verified {
            return Err(anyhow!("Google email is not verified"));
        }
        Ok(claims)
    }
}

fn client_secret_for<'a>(
    client_secret: Option<&'a str>,
    client_secret_client_id: Option<&str>,
    client_id: &str,
) -> Option<&'a str> {
    (client_secret_client_id == Some(client_id))
        .then_some(client_secret)
        .flatten()
}

fn token_exchange_params<'a>(
    code: &'a str,
    code_verifier: &'a str,
    redirect_uri: &'a str,
    client_id: &'a str,
    client_secret: Option<&'a str>,
) -> Vec<(&'a str, &'a str)> {
    let mut params = vec![("code", code), ("client_id", client_id)];
    if let Some(secret) = client_secret {
        params.push(("client_secret", secret));
    }
    params.extend([
        ("code_verifier", code_verifier),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
    ]);
    params
}

#[cfg(test)]
mod tests {
    use super::{client_secret_for, token_exchange_params};

    #[test]
    fn client_secret_is_only_selected_for_its_configured_client() {
        assert_eq!(
            client_secret_for(Some("secret"), Some("desktop"), "desktop"),
            Some("secret")
        );
        assert_eq!(
            client_secret_for(Some("secret"), Some("desktop"), "android"),
            None
        );
    }

    #[test]
    fn token_exchange_omits_secret_when_unconfigured() {
        let params = token_exchange_params("code", "verifier", "redirect", "client", None);

        assert_eq!(
            params,
            vec![
                ("code", "code"),
                ("client_id", "client"),
                ("code_verifier", "verifier"),
                ("redirect_uri", "redirect"),
                ("grant_type", "authorization_code"),
            ]
        );
    }

    #[test]
    fn token_exchange_includes_configured_secret() {
        let params =
            token_exchange_params("code", "verifier", "redirect", "client", Some("secret"));

        assert_eq!(params[2], ("client_secret", "secret"));
    }
}
