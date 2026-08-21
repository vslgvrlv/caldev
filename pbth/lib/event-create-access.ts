import { EventType, Role } from "../types";

export type EventCreateAccess = {
  canCreate: boolean;
  allowedTypes: EventType[];
  defaultType: EventType | null;
};

export type EventCreateViewProps = Pick<EventCreateAccess, "allowedTypes"> & {
  defaultType: EventType;
};

const ALL_EVENT_TYPES = Object.values(EventType);

export function eventCreateAccess(role: Role): EventCreateAccess {
  const allowedTypes =
    role === Role.TRAINER
      ? [EventType.TRAINING, EventType.MEETING]
      : role === Role.ADMIN || role === Role.CAPTAIN
        ? [...ALL_EVENT_TYPES]
        : [];

  return {
    canCreate: allowedTypes.length > 0,
    allowedTypes,
    defaultType: allowedTypes[0] ?? null,
  };
}

export function eventCreateViewProps(access: EventCreateAccess): EventCreateViewProps | null {
  if (!access.canCreate || access.defaultType === null) return null;
  return { allowedTypes: access.allowedTypes, defaultType: access.defaultType };
}
