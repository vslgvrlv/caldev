import React from 'react';
import type { Event, Role } from '../types';
import { ShellContext } from './context';
import { shellExtensions, type EventBlockProps } from './extensions';

/**
 * Блоки треков на экране события (pbth/shell/ext/*: `eventBlocks`).
 * EventDetailView рисует их одной строкой; сам он о треках ничего не знает.
 */
export const EventExtBlocks: React.FC<{ event: Event; viewerRole: Role }> = ({ event, viewerRole }) => {
  const shell = React.useContext(ShellContext);
  if (!shell?.user || !shell.team || !shell.teamCode || shellExtensions.eventBlocks.length === 0) return null;
  const props: EventBlockProps = {
    user: shell.user,
    team: shell.team,
    teamCode: shell.teamCode,
    role: shell.team.role,
    teams: shell.teams,
    event,
    viewerRole,
    reload: shell.reload,
  };
  const blocks = shellExtensions.eventBlocks.filter((block) => !block.visible || block.visible(props));
  if (blocks.length === 0) return null;
  return (
    <>
      {blocks.map(({ id, Component }) => (
        <Component key={id} {...props} />
      ))}
    </>
  );
};
