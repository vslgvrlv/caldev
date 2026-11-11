import React from 'react';
import { avatarHtml } from './team-mark';

export type AvatarProps = {
  name?: string | null;
  /** Диаметр в пикселях. */
  size?: number;
};

/** Круг с инициалами на втором слое стекла. */
export const Avatar: React.FC<AvatarProps> = ({ name, size = 40 }) => (
  <span style={{ display: 'inline-flex', flex: 'none', lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: avatarHtml(name, size) }} />
);
