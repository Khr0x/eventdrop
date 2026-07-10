import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export const EVENT_STATUS = {
  RECEIVED: "RECEIVED",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
} as const;

export type EventStatus = (typeof EVENT_STATUS)[keyof typeof EVENT_STATUS];

export interface EventRecord {
  id: string;
  source: string;
  type: string;
  payload: Record<string, unknown>;
  status: EventStatus;
  createdAt: string;
  processedAt?: string;
  attempts: number;
  result?: Record<string, unknown>;
  error?: string;
  idempotencyKey?: string;
  GSI1PK: string;
  GSI1SK: string;
}

export class EventRepository {
  constructor(private readonly tableName: string) {}

  get docClient(): DynamoDBDocumentClient {
    return docClient;
  }

  get table(): string {
    return this.tableName;
  }

  async create(event: EventRecord): Promise<EventRecord> {
    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: event,
      })
    );
    return event;
  }

  async getById(id: string): Promise<EventRecord | null> {
    const result = await docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id },
      })
    );
    return (result.Item as EventRecord) ?? null;
  }

  async listRecent(limit = 20): Promise<EventRecord[]> {
    const result = await docClient.send(
      new ScanCommand({
        TableName: this.tableName,
        Limit: limit,
      })
    );
    return (result.Items as EventRecord[]) ?? [];
  }

  async getByIdempotencyKey(key: string): Promise<EventRecord | null> {
    const result = await docClient.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "idempotencyKey = :key",
        ExpressionAttributeValues: {
          ":key": key,
        },
      })
    );
    return (result.Items?.[0] as EventRecord) ?? null;
  }

  async updateStatus(
    id: string,
    status: EventStatus,
    updates?: Partial<
      Pick<EventRecord, "result" | "error" | "processedAt" | "attempts">
    >
  ): Promise<void> {
    const setExpressions: string[] = [
      "#status = :status",
      "GSI1PK = :gsi1pk",
      "GSI1SK = :gsi1sk",
    ];
    const expressionAttributeNames: Record<string, string> = {
      "#status": "status",
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ":status": status,
      ":gsi1pk": `STATUS#${status}`,
      ":gsi1sk": new Date().toISOString(),
    };

    if (updates) {
      if (updates.result !== undefined) {
        setExpressions.push("#result = :result");
        expressionAttributeNames["#result"] = "result";
        expressionAttributeValues[":result"] = updates.result;
      }
      if (updates.error !== undefined) {
        setExpressions.push("#error = :error");
        expressionAttributeNames["#error"] = "error";
        expressionAttributeValues[":error"] = updates.error;
      }
      if (updates.processedAt !== undefined) {
        setExpressions.push("#processedAt = :processedAt");
        expressionAttributeNames["#processedAt"] = "processedAt";
        expressionAttributeValues[":processedAt"] = updates.processedAt;
      }
      if (updates.attempts !== undefined) {
        setExpressions.push("#attempts = :attempts");
        expressionAttributeNames["#attempts"] = "attempts";
        expressionAttributeValues[":attempts"] = updates.attempts;
      }
    }

    await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        UpdateExpression: `SET ${setExpressions.join(", ")}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  }
}
