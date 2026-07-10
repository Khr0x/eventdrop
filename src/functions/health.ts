import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { success } from "../shared/response";
import type { ApiResponse } from "../shared/response";
import { createLogger } from "../shared/logger";

const logger = createLogger("health");

export async function handler(
  _event: APIGatewayProxyEventV2
): Promise<ApiResponse> {
  return success({ status: "ok", timestamp: new Date().toISOString() });
}
