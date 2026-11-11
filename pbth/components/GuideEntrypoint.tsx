import React from "react";
import { guidePathForRole } from "../lib/guide-access";
import { Icon, Row } from "../ui";
import "../views/team/team.css";
import { Role } from "../types";

type GuideEntrypointProps = {
  role: Role | null | undefined;
};

/** Строка «Инструкции» в профиле: открывает инструкцию для роли человека. Класть внутрь стеклянной панели. */
export const GuideEntrypoint: React.FC<GuideEntrypointProps> = ({ role }) => {
  if (role == null) return null;

  return (
    <Row
      as="a"
      href={guidePathForRole(role)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Открыть инструкцию по работе с PaintBall Team Hub"
      lead={
        <span className="pbth-iconlead ui-glass2">
          <Icon name="book-open" />
        </span>
      }
      title="Инструкции"
      sub="Пошаговая инструкция для твоей роли"
      chevron
    />
  );
};
