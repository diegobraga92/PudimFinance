use opentelemetry::trace::TracerProvider;
use opentelemetry::KeyValue;
use opentelemetry_otlp::SpanExporter;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use tracing_subscriber::prelude::*;
use tracing_subscriber::EnvFilter;

/// Initializes structured JSON logging and OpenTelemetry tracing.
///
/// Filters verbosity via the `RUST_LOG` environment variable.
pub fn init_logging(otel_endpoint: &str, service_name: &str) {
    let exporter = SpanExporter::builder()
        .with_tonic()
        .with_endpoint(otel_endpoint)
        .build()
        .expect("Failed to create OTLP span exporter");

    let tracer_provider = SdkTracerProvider::builder()
        .with_resource(
            Resource::builder()
                .with_attributes([
                    KeyValue::new("service.name", service_name.to_string()),
                    KeyValue::new("service.version", env!("CARGO_PKG_VERSION").to_string()),
                ])
                .build(),
        )
        .with_batch_exporter(exporter)
        .build();

    let tracer = tracer_provider.tracer("pudimfinance-backend");
    opentelemetry::global::set_tracer_provider(tracer_provider);
    let telemetry_layer = tracing_opentelemetry::layer().with_tracer(tracer);
    let stdout_layer = tracing_subscriber::fmt::layer()
        .json()
        .with_target(true)
        .with_current_span(true)
        .with_span_list(true);

    tracing_subscriber::registry()
        .with(EnvFilter::from_default_env())
        .with(telemetry_layer)
        .with(stdout_layer)
        .init();

    tracing::info!("Logging and tracing initialized");
}
