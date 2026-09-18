use anyhow::{anyhow, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Access token lifetime of 15 minutes. Short-lived, refreshed via refresh token.
pub const ACCESS_TOKEN_TTL_SECS: i64 = 15 * 60;
/// Refresh token lifetime, 7 days.
pub const REFRESH_TOKEN_TTL_SECS: i64 = 7 * 24 * 60 * 60;

/// JWT claims embedded in tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// User ID.
    pub sub: String,
    /// User email.
    pub email: String,
    /// Role, either `user` or `admin`.
    pub role: String,
    /// Token expiry (epoch seconds).
    pub exp: usize,
    /// Token issued-at (epoch seconds).
    pub iat: usize,
}

/// Computes an HMAC-SHA256 JWT signing key from the configured secret.
fn encoding_key(secret: &str) -> EncodingKey {
    EncodingKey::from_secret(secret.as_bytes())
}

fn decoding_key(secret: &str) -> DecodingKey {
    DecodingKey::from_secret(secret.as_bytes())
}

/// Creates a JWT with the given subject/role and TTL.
pub fn create_token(
    secret: &str,
    user_id: Uuid,
    email: &str,
    role: &str,
    ttl_secs: i64,
) -> Result<String> {
    let now = Utc::now().timestamp() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        role: role.to_string(),
        exp: now + ttl_secs as usize,
        iat: now,
    };

    encode(&Header::default(), &claims, &encoding_key(secret))
        .map_err(|e| anyhow!("failed to encode token: {}", e))
}

/// Verifies a JWT and returns its claims if valid.
pub fn verify_token(secret: &str, token: &str) -> Result<Claims> {
    let data = decode::<Claims>(token, &decoding_key(secret), &Validation::default())
        .map_err(|e| anyhow!("invalid token: {}", e))?;
    Ok(data.claims)
}

/// Hashes a plaintext password using Argon2id.
pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow!("password hashing failed: {}", e))
}

/// Verifies a plaintext password against an Argon2id hash.
pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
    let parsed = PasswordHash::new(hash).map_err(|e| anyhow!("invalid hash: {}", e))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// Returns the non-negative seconds remaining before expiry.
#[allow(dead_code)]
pub fn claims_remaining_secs(claims: &Claims) -> i64 {
    let exp = claims.exp as i64;
    let now = Utc::now().timestamp();
    (exp - now).max(0)
}
