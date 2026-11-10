import React from 'react';
import type { ShellExtension } from '../extensions';
import { Role } from '../../types';
import { DeliveryBlock } from '../../components/track2/DeliveryBlock';

// Трек 2 «Явка»: блок «кому дошло» на экране события — капитану и тренеру.
const ext: ShellExtension = {
  id: 'track2-delivery',
  eventBlocks: [
    {
      id: 'track2-delivery',
      order: 20,
      visible: (props) => props.viewerRole === Role.CAPTAIN || props.viewerRole === Role.TRAINER || props.viewerRole === Role.ADMIN,
      Component: (props) => <DeliveryBlock eventId={props.event.id} />,
    },
  ],
};

export default ext;
