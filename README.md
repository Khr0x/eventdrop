# EventDrop

Serverless API to receive, store, and asynchronously process events and webhooks.

## Architecture

```
Client → API Gateway HTTP API → Lambda (createEvent)
                                  ├── DynamoDB (Events table)
                                  └── SQS → Lambda (processEvent)
                                              ├── DynamoDB (status update)
                                              └── DLQ (failed events)
```

## Prerequisites

- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configured (`aws sts get-caller-identity`)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) (`sam --version`)
- [Node.js](https://nodejs.org/) 22+ (`node --version`)

## Quick Start

```bash
npm install        # Install dependencies
npm test           # Run unit tests
npm run typecheck  # TypeScript check
sam build          # Build for deployment
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events` | Create an event |
| `GET` | `/events/{eventId}` | Get event by ID |
| `GET` | `/events` | List recent events (last 20) |
| `GET` | `/health` | Health check |

### Create an event

```bash
curl -X POST https://<api-id>.execute-api.<region>.amazonaws.com/events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "orders",
    "type": "order.created",
    "payload": { "orderId": "order_001" }
  }'
```

Response: `202 Accepted`
```json
{ "id": "01JXYZ...", "status": "RECEIVED" }
```

### Get an event

```bash
curl https://<api-id>.execute-api.<region>.amazonaws.com/events/<eventId>
```

Response: `200 OK` with the full event record, or `404` if not found.

### List events

```bash
curl https://<api-id>.execute-api.<region>.amazonaws.com/events
```

Response: `200 OK`
```json
{ "events": [...] }
```

### Health check

```bash
curl https://<api-id>.execute-api.<region>.amazonaws.com/health
```

Response: `200 OK`
```json
{ "status": "ok", "timestamp": "2026-07-10T00:00:00.000Z" }
```

### Idempotency

Send an optional `idempotencyKey` to prevent duplicate events:

```bash
curl -X POST https://<api-id>.execute-api.<region>.amazonaws.com/events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "orders",
    "type": "order.created",
    "payload": { "orderId": "order_001" },
    "idempotencyKey": "unique-key-1"
  }'
```

Sending the same request twice returns the existing event (HTTP `200`) without creating a duplicate.

### Forced failure (DLQ test)

Send `"type": "test.force_failure"` to trigger a processing error:

```bash
curl -X POST https://<api-id>.execute-api.<region>.amazonaws.com/events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "test",
    "type": "test.force_failure",
    "payload": {}
  }'
```

The event will be retried 5 times, then sent to the Dead Letter Queue.

## Event Lifecycle

```
RECEIVED → PROCESSING → PROCESSED   (success)
RECEIVED → PROCESSING → FAILED      (retry via SQS → DLQ after 5 attempts)
```

## Deploy

```bash
sam build
sam deploy --guided
```

The `sam deploy --guided` output includes the API endpoint URL.

## Delete

```bash
sam delete
```

The API is public (no authentication). Delete the stack when done practicing.

## Development

```bash
npm install          # Install dependencies
npm test             # Run unit tests (Vitest)
npm run test:watch   # Run tests in watch mode
npm run typecheck    # TypeScript type checking
sam build            # Build Lambda bundles
sam validate         # Validate SAM template
```
