//! Category CRUD endpoints

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tracing::error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::models::{Category, CreateCategoryRequest, UpdateCategoryRequest};
use crate::state::AppState;

/// Query parameters for filtering the category list.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CategoryListParams {
    /// Filter by `income` or `expense`.
    pub r#type: Option<String>,
}

/// Returns a sub-router with all category routes mounted under `/api/categories`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/categories",
            get(list_categories).post(create_category),
        )
        .route(
            "/api/categories/{id}",
            get(get_category)
                .put(update_category)
                .delete(delete_category),
        )
}

/// `true` when `candidate` is a descendant of `category_id`.
///
/// Used to keep the category tree acyclic: moving a category under one of its
/// own subcategories would otherwise create a loop that no descendant query
/// could terminate on.
async fn is_category_descendant(
    pool: &sqlx::PgPool,
    category_id: Uuid,
    candidate: Uuid,
) -> Result<bool, sqlx::Error> {
    let found: Option<Uuid> = sqlx::query_scalar(
        "WITH RECURSIVE descendants AS (
             SELECT id FROM categories WHERE parent_id = $1
             UNION
             SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
         )
         SELECT id FROM descendants WHERE id = $2 LIMIT 1",
    )
    .bind(category_id)
    .bind(candidate)
    .fetch_optional(pool)
    .await?;
    Ok(found.is_some())
}

/// Lists categories, optionally filtered by type.
///
/// Returns `400` if an invalid `type` filter is provided.
#[utoipa::path(
    get,
    path = "/api/categories",
    tag = "Categories",
    params(
        ("type" = Option<String>, Query, description = "Filter by 'income' or 'expense'"),
    ),
    responses(
        (status = 200, description = "List of categories", body = [Category]),
        (status = 400, description = "Invalid type filter"),
    ),
)]
pub async fn list_categories(
    State(state): State<AppState>,
    Query(params): Query<CategoryListParams>,
) -> Result<Json<Vec<Category>>, (StatusCode, Json<serde_json::Value>)> {
    if let Some(t) = &params.r#type {
        if t != "income" && t != "expense" {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "type must be 'income' or 'expense'" })),
            ));
        }
    }

    let categories = match &params.r#type {
        Some(t) => {
            sqlx::query_as::<_, Category>(
                "SELECT id, name, type, parent_id, icon, color, created_at, updated_at
                 FROM categories WHERE type = $1 ORDER BY name",
            )
            .bind(t)
            .fetch_all(&state.pg_pool)
            .await
        }
        None => {
            sqlx::query_as::<_, Category>(
                "SELECT id, name, type, parent_id, icon, color, created_at, updated_at
                 FROM categories ORDER BY name",
            )
            .fetch_all(&state.pg_pool)
            .await
        }
    };

    match categories {
        Ok(cats) => Ok(Json(cats)),
        Err(e) => {
            error!("Failed to list categories: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch categories" })),
            ))
        }
    }
}

/// Creates a new category.
///
/// Returns `400` if the payload is invalid (missing name, invalid type,
/// non-existent parent category).
#[utoipa::path(
    post,
    path = "/api/categories",
    tag = "Categories",
    request_body = CreateCategoryRequest,
    responses(
        (status = 201, description = "Category created", body = Category),
        (status = 400, description = "Invalid category payload"),
    ),
)]
pub async fn create_category(
    State(state): State<AppState>,
    Json(payload): Json<CreateCategoryRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name must not be empty" })),
        ));
    }

    if payload.r#type != "income" && payload.r#type != "expense" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "type must be 'income' or 'expense'" })),
        ));
    }

    if let Some(pid) = payload.parent_id {
        let parent_type: Option<String> =
            sqlx::query_scalar("SELECT type FROM categories WHERE id = $1")
                .bind(pid)
                .fetch_optional(&state.pg_pool)
                .await
                .map_err(|e| {
                    error!("Failed to check parent category: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to validate parent category" })),
                    )
                })?;

        match parent_type {
            None => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "parent_id does not reference an existing category" })),
                ))
            }
            // Income and expense branches must stay separate.
            Some(parent) if parent != payload.r#type => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": "parent category must have the same type (income or expense)"
                    })),
                ))
            }
            Some(_) => {}
        }
    }

    let category = sqlx::query_as::<_, Category>(
        "INSERT INTO categories (name, type, parent_id, icon, color)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, type, parent_id, icon, color, created_at, updated_at",
    )
    .bind(name)
    .bind(&payload.r#type)
    .bind(payload.parent_id)
    .bind(&payload.icon)
    .bind(&payload.color)
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to create category: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create category" })),
        )
    })?;

    Ok((StatusCode::CREATED, Json(category)))
}

/// Fetches a single category by id.
#[utoipa::path(
    get,
    path = "/api/categories/{id}",
    tag = "Categories",
    params(
        ("id" = Uuid, Path, description = "Category UUID"),
    ),
    responses(
        (status = 200, description = "Category found", body = Category),
        (status = 404, description = "Category not found"),
    ),
)]
pub async fn get_category(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Category>, (StatusCode, Json<serde_json::Value>)> {
    let category = sqlx::query_as::<_, Category>(
        "SELECT id, name, type, parent_id, icon, color, created_at, updated_at
         FROM categories WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch category: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch category" })),
        )
    })?;

    match category {
        Some(cat) => Ok(Json(cat)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Category not found" })),
        )),
    }
}

/// Updates an existing category.
///
/// Returns `404` if the category does not exist, `400` for invalid payloads.
#[utoipa::path(
    put,
    path = "/api/categories/{id}",
    tag = "Categories",
    params(
        ("id" = Uuid, Path, description = "Category UUID"),
    ),
    request_body = UpdateCategoryRequest,
    responses(
        (status = 200, description = "Category updated", body = Category),
        (status = 400, description = "Invalid category payload"),
        (status = 404, description = "Category not found"),
    ),
)]
pub async fn update_category(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateCategoryRequest>,
) -> Result<Json<Category>, (StatusCode, Json<serde_json::Value>)> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name must not be empty" })),
        ));
    }

    if payload.r#type != "income" && payload.r#type != "expense" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "type must be 'income' or 'expense'" })),
        ));
    }

    if let Some(pid) = payload.parent_id {
        if pid == id {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "parent_id cannot reference the category itself" })),
            ));
        }

        let parent_type: Option<String> =
            sqlx::query_scalar("SELECT type FROM categories WHERE id = $1")
                .bind(pid)
                .fetch_optional(&state.pg_pool)
                .await
                .map_err(|e| {
                    error!("Failed to check parent category: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to validate parent category" })),
                    )
                })?;

        match parent_type {
            None => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "parent_id does not reference an existing category" })),
                ))
            }
            Some(parent) if parent != payload.r#type => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": "parent category must have the same type (income or expense)"
                    })),
                ))
            }
            Some(_) => {}
        }

        // Moving a category under one of its own descendants would create a cycle.
        let would_cycle = is_category_descendant(&state.pg_pool, id, pid)
            .await
            .map_err(|e| {
                error!("Failed to check category ancestry: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to validate parent category" })),
                )
            })?;

        if would_cycle {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "a category cannot be moved under its own subcategory" })),
            ));
        }
    }

    // Changing the type of a category that has subcategories would leave the
    // tree with mixed income/expense branches.
    let child_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM categories WHERE parent_id = $1")
            .bind(id)
            .fetch_one(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to check subcategories: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to validate category" })),
                )
            })?;

    if child_count.0 > 0 {
        let current_type: Option<String> =
            sqlx::query_scalar("SELECT type FROM categories WHERE id = $1")
                .bind(id)
                .fetch_optional(&state.pg_pool)
                .await
                .map_err(|e| {
                    error!("Failed to fetch category type: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to validate category" })),
                    )
                })?;

        if current_type.as_deref() != Some(payload.r#type.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "remove the subcategories before changing this category's type"
                })),
            ));
        }
    }

    let result = sqlx::query_as::<_, Category>(
        "UPDATE categories
         SET name = $1, type = $2, parent_id = $3, icon = $4, color = $5, updated_at = NOW()
         WHERE id = $6
         RETURNING id, name, type, parent_id, icon, color, created_at, updated_at",
    )
    .bind(name)
    .bind(&payload.r#type)
    .bind(payload.parent_id)
    .bind(&payload.icon)
    .bind(&payload.color)
    .bind(id)
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to update category: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to update category" })),
        )
    })?;

    match result {
        Some(cat) => Ok(Json(cat)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Category not found" })),
        )),
    }
}

/// Deletes a category.
///
/// Returns `409` if the category is referenced by transactions or subcategories,
/// `404` if the category does not exist.
#[utoipa::path(
    delete,
    path = "/api/categories/{id}",
    tag = "Categories",
    params(
        ("id" = Uuid, Path, description = "Category UUID"),
    ),
    responses(
        (status = 204, description = "Category deleted"),
        (status = 404, description = "Category not found"),
        (status = 409, description = "Category is in use"),
    ),
)]
pub async fn delete_category(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let tx_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM transactions WHERE category_id = $1")
            .bind(id)
            .fetch_one(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to check transaction references: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to check category usage" })),
                )
            })?;

    if tx_count.0 > 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": format!(
                    "Category is used by {} transaction(s). Reassign or delete them first.",
                    tx_count.0
                )
            })),
        ));
    }

    let child_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM categories WHERE parent_id = $1")
            .bind(id)
            .fetch_one(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to check subcategory references: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to check subcategory usage" })),
                )
            })?;

    if child_count.0 > 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": format!(
                    "Category has {} subcategor{} that depend on it. Remove them first.",
                    child_count.0,
                    if child_count.0 == 1 { "y" } else { "ies" }
                )
            })),
        ));
    }

    let result = sqlx::query("DELETE FROM categories WHERE id = $1")
        .bind(id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("Failed to delete category: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete category" })),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Category not found" })),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}
