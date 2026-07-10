import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { EventRepository } from "../repositories/event.repository";
import { serverError, success } from "../shared/response";
import type { ApiResponse } from "../shared/response";
import { createLogger } from "../shared/logger";

const logger = createLogger("list-events");

const repository = new EventRepository(process.env.EVENTS_TABLE_NAME!);

export async function handler(
  _event: APIGatewayProxyEventV2
): Promise<ApiResponse> {
  try {
    const events = await repository.listRecent(20);
    return success({ events });
  } catch (error) {
    logger.error("Failed to list events", {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError();
  }
}
