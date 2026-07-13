output "site_url" {
  description = "Public URL of the app (bookmark this) — S3 website hosting"
  value       = "http://${aws_s3_bucket_website_configuration.site.website_endpoint}"
}

output "sync_url" {
  description = "Sync API endpoint the browser calls (API Gateway -> Lambda)"
  value       = "${aws_apigatewayv2_api.sync.api_endpoint}/api"
}

output "site_bucket" {
  description = "Name of the site S3 bucket (upload target)"
  value       = aws_s3_bucket.site.id
}

output "state_bucket" {
  description = "Private bucket holding per-user progress blobs"
  value       = aws_s3_bucket.state.id
}
