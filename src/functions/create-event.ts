import { ulid } from "ulid";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateEventSchema } from "../schemas/create-event.schema";
import {
  EventRepository,
  EVENT_STATUS,
} from "../repositories/event.repository";
import type { EventRecord } from "../repositories/event.repository";
import { badRequest, serverError, success } from "../shared/response";
import type { ApiResponse } from "../shared/response";
import { createLogger } from "../shared/logger";

const logger = createLogger("create-event");

const repository = new EventRepository(process.env.EVENTS_TABLE_NAME!);
const sqsClient = new SQSClient({});

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<ApiResponse> {
  try {
    const body: Record<string, unknown> = event.body
      ? JSON.parse(event.body)
      : {};

    const parsed = CreateEventSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn("Validation failed", {
        errors: parsed.error.message,
      });
      return badRequest(parsed.error.message);
    }

    const { source, type, payload, idempotencyKey } = parsed.data;

    // Idempotency check: if idempotencyKey provided and event exists, return it
    if (idempotencyKey) {
      const existing = await repository.getByIdempotencyKey(idempotencyKey);
      if (existing) {
        logger.info("Returning existing event for idempotencyKey", {
          idempotencyKey,
          eventId: existing.id,
        });
        return success(existing, 200);
      }
    }

    const id = ulid();
    const now = new Date().toISOString();

    const eventRecord: EventRecord = {
      id,
      source,
      type,
      payload,
      status: EVENT_STATUS.RECEIVED,
      createdAt: now,
      attempts: 0,
      GSI1PK: `STATUS#${EVENT_STATUS.RECEIVED}`,
      GSI1SK: now,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };

    await repository.create(eventRecord);

    logger.info("Event created", { eventId: id, source, type });

    // Publish eventId to the processing queue
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: process.env.MAIN_QUEUE_URL!,
        MessageBody: JSON.stringify({ eventId: id }),
      })
    );

    logger.info("Event published to SQS", { eventId: id });

    return success({ id, status: EVENT_STATUS.RECEIVED }, 202);
  } catch (error) {
    logger.error("Failed to create event", {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError();
  }
}
