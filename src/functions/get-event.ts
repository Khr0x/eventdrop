import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { EventRepository } from "../repositories/event.repository";
import { notFound, serverError, success } from "../shared/response";
import type { ApiResponse } from "../shared/response";
import { createLogger } from "../shared/logger";

const logger = createLogger("get-event");

const repository = new EventRepository(process.env.EVENTS_TABLE_NAME!);

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<ApiResponse> {
  try {
    const eventId = event.pathParameters?.eventId;

    if (!eventId) {
      return notFound("Missing eventId");
    }

    const record = await repository.getById(eventId);

    if (!record) {
      return notFound(`Event ${eventId} not found`);
    }

    return success(record);
  } catch (error) {
    logger.error("Failed to get event", {
      eventId: event.pathParameters?.eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError();
  }
}
