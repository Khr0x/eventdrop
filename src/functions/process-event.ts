import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
  EventRepository,
  EVENT_STATUS,
} from "../repositories/event.repository";
import { EventProcessorService } from "../services/event-processor.service";
import { createLogger } from "../shared/logger";

const logger = createLogger("process-event");

const repository = new EventRepository(process.env.EVENTS_TABLE_NAME!);
const processor = new EventProcessorService();

interface SqsMessageBody {
  eventId: string;
}

export const handler = async (
  event: SQSEvent
): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const body: SqsMessageBody = JSON.parse(record.body);
      const { eventId } = body;

      logger.info("Processing SQS message", {
        messageId: record.messageId,
        eventId,
      });

      await processSingleEvent(eventId);

      logger.info("SQS message processed successfully", {
        messageId: record.messageId,
        eventId,
      });
    } catch (error) {
      logger.error("Failed to process SQS message", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });

      batchItemFailures.push({
        itemIdentifier: record.messageId,
      });
    }
  }

  return { batchItemFailures };
};

/**
 * Process a single event identified by eventId.
 * Implements the state machine:
 *   RECEIVED/FAILED → PROCESSING → PROCESSED (success)
 *   RECEIVED/FAILED → PROCESSING → FAILED (retry via SQS)
 *
 * Idempotency: events already in PROCESSED status are skipped.
 * Retries: on failure, status is set to FAILED and the error is re-thrown
 * so SQS retries via visibility timeout. After maxReceiveCount (5), the
 * message goes to the DLQ.
 */
async function processSingleEvent(eventId: string): Promise<void> {
  // Step 1: Lookup the event in DynamoDB
  const eventRecord = await repository.getById(eventId);

  if (!eventRecord) {
    logger.warn("Event not found in database, acknowledging message", {
      eventId,
    });
    return;
  }

  logger.info("Event record retrieved", {
    eventId,
    currentStatus: eventRecord.status,
    currentAttempts: eventRecord.attempts,
  });

  // Step 2: Idempotency check — skip already-processed events
  if (eventRecord.status === EVENT_STATUS.PROCESSED) {
    logger.info("Event already PROCESSED, skipping", { eventId });
    return;
  }

  // Step 3: Mark as PROCESSING and increment attempts
  const attempts = (eventRecord.attempts ?? 0) + 1;

  await repository.updateStatus(eventId, EVENT_STATUS.PROCESSING, {
    attempts,
  });

  logger.info("Event marked as PROCESSING", { eventId, attempts });

  // Step 4: Execute the processor service (may throw)
  try {
    const result = processor.process(eventRecord.type, eventRecord.payload);

    // Step 5a: Success — mark as PROCESSED
    await repository.updateStatus(eventId, EVENT_STATUS.PROCESSED, {
      result: result as unknown as Record<string, unknown>,
      processedAt: new Date().toISOString(),
      attempts,
    });

    logger.info("Event processed successfully", {
      eventId,
      category: result.category,
      priority: result.priority,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Step 5b: Failure — update status and re-throw for SQS retry
    await repository.updateStatus(eventId, EVENT_STATUS.FAILED, {
      error: errorMessage,
      attempts,
    });

    logger.error("Event processing failed, will retry via SQS", {
      eventId,
      error: errorMessage,
      attempts,
    });

    // Re-throw so the outer catch adds this messageId to batchItemFailures
    throw error;
  }
}
