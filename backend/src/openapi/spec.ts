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
        AuthMeResponse: {
          type: "object",
          properties: {
            authenticated: { type: "boolean" },
            authMethod: { type: "string", enum: ["WEBAPP", "OIDC", "LEGACY_WIDGET", "DEV", null] },
            adminScope: { type: "string", enum: ["NONE", "TEAM", "PLATFORM"] },
            capabilities: { type: "array", items: { type: "string" } },
            managedTeamIds: { type: "array", items: { type: "string", format: "uuid" } },
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
            "200": {
              description: "Auth payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuthMeResponse" },
                },
              },
            },
          },
        },
      },
      "/auth/telegram/oidc/start": {
        get: {
          summary: "Start Telegram OIDC login (Authorization Code + PKCE)",
          parameters: [
            {
              name: "redirectTo",
              in: "query",
              required: false,
              schema: { type: "string", example: "/app" },
            },
          ],
          responses: {
            "302": { description: "Redirect to Telegram OIDC authorize endpoint" },
          },
        },
      },
      "/auth/telegram/oidc/callback": {
        get: {
          summary: "Handle Telegram OIDC callback",
          parameters: [
            { name: "code", in: "query", required: true, schema: { type: "string" } },
            { name: "state", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "302": { description: "Redirect back to application after successful login" },
            "401": { description: "Invalid/expired OIDC state or token" },
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
      "/admin/v1/overview": {
        get: {
          summary: "Admin overview by scope/team",
          responses: {
            "200": { description: "Overview payload" },
            "403": { description: "Admin access required" },
          },
        },
      },
      "/admin/v1/events": {
        get: {
          summary: "Admin events list",
          responses: {
            "200": { description: "Events list" },
            "403": { description: "Admin access required" },
          },
        },
        post: {
          summary: "Admin create event",
          responses: {
            "201": { description: "Event created" },
            "403": { description: "Admin access required" },
          },
        },
      },
      "/admin/v1/events/{eventId}": {
        patch: {
          summary: "Admin update event",
          parameters: [{ name: "eventId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": { description: "Event updated" },
            "404": { description: "Event not found" },
          },
        },
      },
      "/admin/v1/team/members": {
        get: {
          summary: "Admin list team members",
          responses: {
            "200": { description: "Members list" },
            "400": { description: "teamId required" },
          },
        },
      },
      "/admin/v1/team/members/{membershipId}": {
        patch: {
          summary: "Admin update team member role/status",
          parameters: [
            { name: "membershipId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": { description: "Member updated" },
            "404": { description: "Membership not found" },
          },
        },
      },
      "/admin/v1/audit": {
        get: {
          summary: "Admin audit timeline",
          responses: {
            "200": { description: "Audit list" },
            "403": { description: "Admin access required" },
          },
        },
      },
    },
  };
}
