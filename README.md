# EventDrop — Serverless Event Inbox

API serverless para recibir, almacenar y procesar eventos o webhooks de forma asíncrona. Construida sobre AWS Lambda, API Gateway, DynamoDB y SQS con infraestructura como código (AWS SAM).

## Arquitectura

```
Cliente
  │
  │  POST /events
  ▼
API Gateway HTTP API ($default stage)
  │
  ▼
Lambda createEvent
  ├── Valida el body (Zod)
  ├── Genera ULID como identificador
  ├── Guarda en DynamoDB (status: RECEIVED)
  └── Publica { eventId } en SQS
           │
           ▼
     Lambda processEvent (trigger SQS)
           │
           ├── Busca el evento en DynamoDB
           ├── Omite si ya está PROCESSED (idempotencia)
           ├── Marca PROCESSING e incrementa attempts
           ├── Ejecuta EventProcessorService (categoriza + prioriza)
           ├── Marca PROCESSED (éxito) o FAILED + relanza (reintento)
           │
           ▼
     SQS → DLQ (tras 5 reintentos fallidos)
```

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 22 (`nodejs22.x`) + TypeScript |
| Infraestructura como código | AWS SAM (`template.yaml`) |
| API | API Gateway HTTP API (stage `$default`, CORS, access logs) |
| Compute | AWS Lambda (arm64, 256 MB) — 5 funciones independientes |
| Persistencia | DynamoDB on-demand (tabla `Events`, PK `id`, GSI `GSI1`, PITR habilitado) |
| Mensajería | SQS estándar + DLQ (long polling, `maxReceiveCount: 5`) |
| Validación | Zod (esquemas tipados, `400` con detalle en error) |
| Identificadores | ULID (ordenables por tiempo) |
| Observabilidad | CloudWatch Logs (JSON estructurado con `eventId`, `functionName`, `timestamp`) |
| Pruebas | Vitest (8 tests unitarios sobre `EventProcessorService`) |
| Empaquetado | esbuild (minificación, target ES2022) |

## Estructura del proyecto

```
eventdrop/
├── .github/workflows/
│   ├── deploy.yml              # CI/CD: despliegue automático a AWS
│   └── delete.yml              # CI/CD: eliminación del stack
├── src/
│   ├── functions/              # Handlers de Lambda (una función por endpoint)
│   │   ├── create-event.ts     # POST /events
│   │   ├── get-event.ts        # GET /events/{eventId}
│   │   ├── list-events.ts      # GET /events
│   │   ├── process-event.ts    # Worker SQS (máquina de estados)
│   │   └── health.ts           # GET /health
│   ├── repositories/
│   │   └── event.repository.ts # Capa de acceso a DynamoDB
│   ├── services/
│   │   └── event-processor.service.ts  # Lógica de procesamiento
│   ├── schemas/
│   │   └── create-event.schema.ts      # Esquema Zod de validación
│   └── shared/
│       ├── response.ts         # Helpers HTTP (success, notFound, badRequest, serverError)
│       └── logger.ts           # Logger JSON estructurado
├── events/                     # Fixtures para pruebas locales
│   ├── create-event.json
│   └── sqs-event.json
├── tests/
│   └── event-processor.test.ts # Pruebas unitarias del procesador
├── template.yaml               # Infraestructura como código (SAM)
├── package.json
└── tsconfig.json
```

## Decisiones de arquitectura

| ID | Decisión | Motivación |
|---|---|---|
| ADR-001 | HTTP API sobre REST API | Menor costo y latencia; CORS incluido |
| ADR-002 | Node.js 22 + TypeScript | Runtime vigente de AWS; tipado en handlers y schemas |
| ADR-003 | AWS SAM como IaC | Stack completo con un solo comando; pruebas locales |
| ADR-004 | DynamoDB on-demand | Sin servidores que administrar; PITR + SSE habilitados |
| ADR-005 | SQS + DLQ | Desacopla recepción de procesamiento; reintentos automáticos; `maxReceiveCount: 5`, `VisibilityTimeout: 180s`, long polling |
| ADR-006 | Idempotencia en worker + `idempotencyKey` | SQS entrega al menos una vez; evita procesamiento duplicado; `ReportBatchItemFailures` en respuestas parciales |
| ADR-007 | Zod para validación | Esquemas tipados; `400` con detalle del error de validación |
| ADR-008 | ULID como ID de eventos | Ordenables por tiempo; facilitan trazabilidad en logs |
| ADR-009 | Sin framework; handlers planos | Una Lambda por endpoint; cold starts mínimos; permisos IAM y métricas granulares |
| ADR-010 | Logs JSON con `eventId` | Trazabilidad completa del ciclo de vida en CloudWatch Logs Insights |
| ADR-011 | Vitest para pruebas | TypeScript sin configuración; enfoque en lógica pura sin dependencias de AWS |
| ADR-012 | Alcance reducido del MVP | Sin frontend, autenticación, dominio personalizado, CI/CD avanzado ni monitoreo |

## Ciclo de vida de un evento

```
RECEIVED  →  PROCESSING  →  PROCESSED    (camino feliz)
                           →  FAILED       (reintento vía SQS → DLQ tras 5 intentos)
```

1. Cliente envía `POST /events` con `source`, `type`, `payload`
2. `createEvent` valida con Zod, genera ULID, guarda en DynamoDB (`RECEIVED`) y publica en SQS
3. El cliente recibe `202 { id, status: "RECEIVED" }`
4. SQS activa `processEvent`, que busca el evento, verifica que no esté `PROCESSED`, lo marca `PROCESSING` y ejecuta el procesador
5. El procesador categoriza por tipo (`payment.*` → PAYMENT, `order.*` → ORDERS) y asigna prioridad (`*.critical` → HIGH)
6. Si el procesamiento falla, el evento se marca `FAILED` y se relanza la excepción para que SQS reintente
7. Tras 5 reintentos fallidos, el mensaje va a la Dead Letter Queue

## Endpoints

| Método | Ruta | Descripción | Respuesta |
|---|---|---|---|
| `POST` | `/events` | Crear un evento | `202 { id, status }` |
| `GET` | `/events/{eventId}` | Consultar un evento | `200` evento o `404` |
| `GET` | `/events` | Listar últimos 20 eventos | `200 { events: [...] }` |
| `GET` | `/health` | Health check | `200 { status, timestamp }` |

### POST /events

```bash
curl -X POST https://<api-id>.execute-api.<region>.amazonaws.com/events \
  -H "Content-Type: application/json" \
  -d '{"source":"orders","type":"order.created","payload":{"orderId":"order_001"}}'
```

Campos del body:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `source` | string | Sí | Sistema que produce el evento |
| `type` | string | Sí | Tipo de evento (ej. `order.created`) |
| `payload` | object | Sí | Contenido libre del evento |
| `idempotencyKey` | string | No | Clave de idempotencia (evita duplicados) |

### Idempotencia

```bash
# Primer request — crea el evento
curl -X POST .../events -d '{...,"idempotencyKey":"key-123"}'  # → 202

# Segundo request con la misma clave — devuelve el existente
curl -X POST .../events -d '{...,"idempotencyKey":"key-123"}'  # → 200
```

### Forzar un fallo (prueba de DLQ)

```bash
curl -X POST https://<api-id>.execute-api.<region>.amazonaws.com/events \
  -H "Content-Type: application/json" \
  -d '{"source":"test","type":"test.force_failure","payload":{}}'
```

El worker falla 5 veces y el mensaje termina en la Dead Letter Queue.

## Despliegue

### Requisitos

| Herramienta | Instalación | Verificación |
|---|---|---|
| AWS CLI 2.x | `brew install awscli` | `aws --version` |
| SAM CLI 1.x | `brew install aws-sam-cli` | `sam --version` |
| Node.js 22+ | `brew install node` | `node --version` |

Configurar credenciales AWS:

```bash
aws configure
# AWS Access Key ID: <tu-access-key>
# AWS Secret Access Key: <tu-secret-key>
# Default region name: us-east-1
# Default output format: json
```

### Desde local

```bash
npm install
sam build
sam deploy --guided
```

Durante `sam deploy --guided`:

| Pregunta | Respuesta |
|---|---|
| Stack Name | `eventdrop` |
| AWS Region | `us-east-1` |
| Confirm changes before deploy | `Y` |
| Allow SAM CLI IAM role creation | `Y` |
| Save arguments to config file | `Y` |
| AllowedOrigin | `*` |

Al finalizar, el output muestra la URL de la API:

```
ApiEndpoint: https://<api-id>.execute-api.<region>.amazonaws.com
```

### Desde GitHub Actions

El proyecto incluye workflows de CI/CD en `.github/workflows/`.

**Configurar AWS (OIDC):**

1. Consola AWS → IAM → Identity Providers → Add provider
   - **Provider type:** `OpenID Connect`
   - **Provider URL:** `https://token.actions.githubusercontent.com`
   - **Audience:** `sts.amazonaws.com`

2. IAM → Roles → Create role → Web identity
   - Identity Provider: `token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
   - GitHub organization: tu usuario u organización de GitHub
   - Política: `AdministratorAccess` (práctica) o la política restringida de más abajo
   - Nombre: `github-actions-eventdrop`

3. Restringir el rol al repositorio: editar la Trust Relationship y acotar el campo `sub`:

```json
{
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
    },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": "repo:<usuario-o-org>/eventdrop:*"
    }
  }
}
```

4. Anotar el ARN del rol: `arn:aws:iam::<account-id>:role/github-actions-eventdrop`

**Configurar GitHub:**

Settings → Secrets and variables → Actions → Secrets:

| Secret | Valor |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::<account-id>:role/github-actions-eventdrop` |
| `AWS_REGION` | `us-east-1` |

Con OIDC no se necesitan `AWS_ACCESS_KEY_ID` ni `AWS_SECRET_ACCESS_KEY`. GitHub obtiene credenciales temporales automáticamente.

**Workflows incluidos:**

| Workflow | Gatillo | Qué hace |
|---|---|---|
| `deploy.yml` | Push a `main` o manual | Checkout → Node.js → SAM → credenciales OIDC → `npm ci` → type check → tests → `sam build` → `sam deploy` |
| `delete.yml` | Solo manual | Credenciales OIDC → `sam delete --no-prompts` |

**Política IAM restringida (alternativa a AdministratorAccess):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateChangeSet", "cloudformation:CreateStack",
        "cloudformation:DeleteStack", "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStacks", "cloudformation:ExecuteChangeSet",
        "cloudformation:GetTemplate", "cloudformation:UpdateStack",
        "cloudformation:ValidateTemplate"
      ],
      "Resource": "arn:aws:cloudformation:*:<account-id>:stack/eventdrop/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:AddPermission", "lambda:CreateFunction", "lambda:DeleteFunction",
        "lambda:GetFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration"
      ],
      "Resource": "arn:aws:lambda:*:<account-id>:function:eventdrop-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "apigatewayv2:CreateApi", "apigatewayv2:CreateRoute", "apigatewayv2:CreateStage",
        "apigatewayv2:DeleteApi", "apigatewayv2:DeleteRoute", "apigatewayv2:DeleteStage",
        "apigatewayv2:GetApi", "apigatewayv2:GetRoutes", "apigatewayv2:GetStages",
        "apigatewayv2:UpdateApi", "apigatewayv2:UpdateRoute", "apigatewayv2:UpdateStage"
      ],
      "Resource": "arn:aws:apigateway:*::/apis/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable", "dynamodb:DeleteTable",
        "dynamodb:DescribeTable", "dynamodb:UpdateTable"
      ],
      "Resource": "arn:aws:dynamodb:*:<account-id>:table/Events"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:CreateQueue", "sqs:DeleteQueue",
        "sqs:GetQueueAttributes", "sqs:SetQueueAttributes", "sqs:TagQueue"
      ],
      "Resource": "arn:aws:sqs:*:<account-id>:EventDrop-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole",
        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:PassRole",
        "iam:AttachRolePolicy", "iam:DetachRolePolicy"
      ],
      "Resource": "arn:aws:iam::<account-id>:role/eventdrop-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup", "logs:DeleteLogGroup",
        "logs:DescribeLogGroups", "logs:PutRetentionPolicy"
      ],
      "Resource": "arn:aws:logs:*:<account-id>:log-group:*eventdrop*:*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:CreateBucket", "s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::aws-sam-cli-managed-default-*", "arn:aws:s3:::aws-sam-cli-managed-default-*/*"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:ListStacks", "lambda:ListFunctions",
        "apigatewayv2:GetApis", "dynamodb:ListTables",
        "sqs:ListQueues", "iam:ListRoles", "logs:DescribeLogGroups"
      ],
      "Resource": "*"
    }
  ]
}
```

## Desarrollo

```bash
npm install          # Instalar dependencias
npm test             # Ejecutar pruebas unitarias (Vitest, 8 tests)
npm run test:watch   # Pruebas en modo watch
npm run typecheck    # Verificación de tipos (tsc --noEmit)
sam build            # Compilar handlers con esbuild
sam validate         # Validar template SAM
sam deploy --guided  # Desplegar a AWS
sam delete           # Eliminar el stack
```

## Eliminar recursos

```bash
sam delete
```

O desde GitHub Actions: Actions → Delete EventDrop Stack → Run workflow.

La API es pública (sin autenticación). Eliminar los recursos al terminar la práctica para evitar costos.

## Fuera del alcance

Por decisión de diseño: frontend, autenticación (Cognito/JWT), dominio personalizado, Step Functions, EventBridge, WebSockets, integraciones reales con servicios externos, arquitectura multi-tenant, pipeline CI/CD avanzado y monitoreo.
