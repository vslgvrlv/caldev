import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EVENT_LABELS } from "../../constants";
import { eventCreateAccess, eventCreateViewProps } from "../../lib/event-create-access";
import { EventType, Role } from "../../types";
import { CreateEventView } from "../../views/CreateEventView";

describe("eventCreateAccess", () => {
  it("lets trainer create only a training or gathering with an allowed default", () => {
    const access = eventCreateAccess(Role.TRAINER);
    expect(access.canCreate).toBe(true);
    expect(access.allowedTypes).toEqual([EventType.TRAINING, EventType.MEETING]);
    expect(access.defaultType).toBe(EventType.TRAINING);
    expect(access.allowedTypes).toContain(access.defaultType);
  });

  it("keeps the full current list for captain and admin", () => {
    const all = Object.values(EventType);
    for (const role of [Role.CAPTAIN, Role.ADMIN]) {
      const access = eventCreateAccess(role);
      expect(access.canCreate).toBe(true);
      expect(access.allowedTypes).toEqual(all);
      expect(access.allowedTypes).toContain(access.defaultType);
    }
  });

  it("does not expose event creation to player", () => {
    expect(eventCreateAccess(Role.PLAYER)).toEqual({
      canCreate: false,
      allowedTypes: [],
      defaultType: null,
    });
  });

  it("does not produce form props when creation is unavailable", () => {
    expect(eventCreateViewProps(eventCreateAccess(Role.PLAYER))).toBeNull();
    expect(eventCreateViewProps(eventCreateAccess(Role.TRAINER))).toEqual({
      allowedTypes: [EventType.TRAINING, EventType.MEETING],
      defaultType: EventType.TRAINING,
    });
  });

  it("renders only trainer-visible event types in the real form", () => {
    const trainer = eventCreateAccess(Role.TRAINER);
    const html = renderToStaticMarkup(
      React.createElement(CreateEventView, {
        onBack: () => undefined,
        onCreate: () => undefined,
        allowedTypes: trainer.allowedTypes,
        defaultType: trainer.defaultType!,
      }),
    );

    expect(html).toContain(EVENT_LABELS[EventType.TRAINING]);
    expect(html).toContain(EVENT_LABELS[EventType.MEETING]);
    for (const type of Object.values(EventType).filter((item) => !trainer.allowedTypes.includes(item))) {
      expect(html).not.toContain(EVENT_LABELS[type]);
    }
  });
});
