# German Study — infrastructure.
# Static site on S3 (public website hosting) + one Lambda (Function URL) that syncs
# per-user progress blobs in a private S3 bucket. No EC2, no API Gateway, no DynamoDB.
# See ../docs/2026-07-13-deployment-and-sync-design.md and ../CLAUDE.md.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # Local backend: tfstate is committed to the repo, per project decision.
  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "aws" {
  region = var.region
}

locals {
  name = "german-study"
}

# ---------------------------------------------------------------------------
# Static site bucket (public read, S3 website hosting).
# NOTE: CloudFront would be nicer (HTTPS + one origin) but this AWS account has an
# unverified-account hold that blocks CloudFront AND public Lambda Function URLs. Plain
# S3 website hosting and API Gateway are NOT blocked, so we use those — cross-device sync
# works today. If/when the account is verified, this can move behind CloudFront.
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "site" {
  bucket = "${local.name}-site-${var.suffix}"
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  index_document { suffix = "login.html" } # login is the entry point / wrapper
  error_document { key = "login.html" }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  depends_on = [aws_s3_bucket_public_access_block.site]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicRead"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
    }]
  })
}

# ---------------------------------------------------------------------------
# State bucket (private; per-user JSON blobs under users/)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "state" {
  bucket = "${local.name}-state-${var.suffix}"
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------------
# Lambda role + policy (least privilege: only its own state prefix)
# ---------------------------------------------------------------------------
resource "aws_iam_role" "lambda" {
  name = "${local.name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${local.name}-lambda-policy"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # users/*  = per-user progress blobs.
        # admin/*  = the single visibility/override config the admin panel writes.
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject"]
        Resource = [
          "${aws_s3_bucket.state.arn}/users/*",
          "${aws_s3_bucket.state.arn}/admin/*",
        ]
      },
      {
        # GetObject on a missing key does a ListBucket check to return 404 vs 403.
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.state.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Lambda function (packaged from lambda/) + public Function URL
# ---------------------------------------------------------------------------
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_lambda_function" "sync" {
  function_name    = "${local.name}-sync"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      STATE_BUCKET = aws_s3_bucket.state.id
      TOKEN_SECRET = var.token_secret
      PW_MOHAMED   = var.pw_mohamed
      PW_MUSTAFA   = var.pw_mustafa
    }
  }
}

# ---------------------------------------------------------------------------
# API Gateway (HTTP API) -> Lambda. Public HTTPS endpoint that invokes the Lambda
# server-side, so it works despite the account's block on public Lambda Function URLs.
# The browser calls  <api>/api  with a JSON body; payload format 2.0 gives the Lambda
# event.requestContext.http.method and event.body, which index.mjs already reads.
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "sync" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "sync" {
  api_id                 = aws_apigatewayv2_api.sync.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sync.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sync" {
  api_id    = aws_apigatewayv2_api.sync.id
  route_key = "POST /api"
  target    = "integrations/${aws_apigatewayv2_integration.sync.id}"
}

resource "aws_apigatewayv2_stage" "sync" {
  api_id      = aws_apigatewayv2_api.sync.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.sync.execution_arn}/*/*"
}
