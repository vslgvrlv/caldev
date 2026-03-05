export function buildOpenApiSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "PBTH API",
      version: "1.0.0",
      description: "PaintBall Team Hub API v1",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      schemas: {
        ApiError: {
          type: "object",
          required: ["code", "detail", "correlationId"],
          properties: {
            code: { type: "string", example: "INVITE_EXPIRED" },
            detail: { type: "string", example: "Invite expired" },
            correlationId: { type: "string", format: "uuid" },
          },
        },
        Event: {
          type: "object",
          required: ["id", "type", "title", "startAt", "rsvpStatus"],
          properties: {
            id: { type: "string", format: "uuid" },
            teamId: { type: "string", format: "uuid" },
            type: { type: "string" },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            startAt: { type: "string", format: "date-time" },
            endAt: { type: "string", format: "date-time", nullable: true },
            teamTimezone: { type: "string", example: "Europe/Moscow" },
            financeState: { type: "string", enum: ["NOT_CALCULATED", "COLLECTING", "CLOSED"] },
            rsvpStatus: { type: "string", enum: ["UNANSWERED", "PENDING", "CONFIRMED", "DECLINED"] },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" } } } } },
            },
          },
        },
      },
      "/release/version": {
        get: {
          summary: "Runtime release version metadata",
          responses: {
            "200": {
              description: "Release metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["releaseId", "commit", "builtAt"],
                    properties: {
                      releaseId: { type: "string", example: "v2026.02.28-1" },
                      commit: { type: "string", example: "a1b2c3d4e5f6" },
                      builtAt: { type: "string", format: "date-time", example: "2026-02-28T15:03:01Z" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/auth/me": {
        get: {
          summary: "Get current auth session",
          responses: {
            "200": { description: "Auth payload" },
          },
        },
      },
      "/init": {
        get: {
          summary: "Initialize app state",
          responses: {
            "200": { description: "Init payload" },
            "401": {
              description: "Authentication required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiError" },
                },
              },
            },
          },
        },
      },
      "/teams/invites/{token}": {
        get: {
          summary: "Get invite details",
          parameters: [{ name: "token", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "Invite details" }, "404": { description: "Not found" } },
        },
      },
      "/teams/invites/{token}/accept": {
        post: {
          summary: "Accept invite",
          parameters: [{ name: "token", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": { description: "Accepted" },
            "409": {
              description: "Invite conflict",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
            },
          },
        },
      },
      "/rsvp": {
        post: {
          summary: "Set RSVP status",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["eventId", "status"],
                  properties: {
                    eventId: { type: "string", format: "uuid" },
                    status: { type: "string", enum: ["UNANSWERED", "PENDING", "CONFIRMED", "DECLINED"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated" },
            "404": { description: "Event not found" },
          },
        },
      },
      "/finance/payments": {
        post: {
          summary: "Create payment transaction",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string", minLength: 8, maxLength: 128 },
              description: "Idempotency key for safe retries of write operation",
            },
          ],
          responses: {
            "201": { description: "Payment created" },
            "200": { description: "Idempotent replay response" },
            "400": { description: "Validation error" },
            "403": { description: "Forbidden" },
          },
        },
      },
      "/transactions": {
        post: {
          summary: "Create transaction (legacy alias)",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string", minLength: 8, maxLength: 128 },
              description: "Idempotency key for safe retries of write operation",
            },
          ],
          responses: {
            "201": { description: "Transaction created" },
            "200": { description: "Idempotent replay response" },
          },
        },
      },
    },
  };
}
