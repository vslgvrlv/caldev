import React from 'react';
import { joinUrl, track1Api, type TeamJoinLink } from '../../api/track1';
import { confirmAction, errorText, notify } from '../../lib/notify';
import { QrCode } from './QrCode';
import { Button, Sheet } from '../../ui';
import { copyText } from '../../lib/copy-text';
import { joinLinkHint } from '../../lib/team-roster';
import '../../views/team/team.css';

// Ссылка команды для капитана и тренера (трек 1): ссылка, код, QR,
// «Поделиться»; капитану ещё «Отозвать и выпустить новую» (`canRotate`).
// Ссылка постоянная: по ней не вступают сразу, а подают заявку — её
// принимает капитан или тренер.

export const TeamJoinLinkSheet: React.FC<{
  teamId: string;
  teamName: string;
  /** Отозвать и выпустить новую может только капитан. */
  canRotate: boolean;
  onClose: () => void;
}> = ({ teamId, teamName, canRotate, onClose }) => {
  const [link, setLink] = React.useState<TeamJoinLink | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async () => {
    setFailed(false);
    try {
      setLink(await track1Api.getTeamJoinLink(teamId));
    } catch {
      setFailed(true);
    }
  }, [teamId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const url = link ? joinUrl(typeof window !== 'undefined' ? window.location.origin : '', link.code) : '';

  const share = async () => {
    if (!url) return;
    const text = `Вступай в команду «${teamName}» в PBTH`;
    if (navigator.share) {
      try {
        await navigator.share({ title: teamName, text, url });
        return;
      } catch (error) {
        if ((error as { name?: string } | null)?.name === 'AbortError') return;
      }
    }
    if (await copyText(url)) {
      notify.success('Ссылка скопирована');
    } else {
      notify.error('Не получилось скопировать. Выдели ссылку и скопируй вручную.');
    }
  };

  const copy = async () => {
    if (!url) return;
    if (await copyText(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      notify.error('Не получилось скопировать. Выдели ссылку и скопируй вручную.');
    }
  };

  const rotate = async () => {
    const ok = await confirmAction(
      'Старая ссылка и её QR перестанут работать сразу. Новую придётся разослать заново. Выпустить новую?',
      { confirmLabel: 'Выпустить новую', danger: true },
    );
    if (!ok) return;
    setRotating(true);
    try {
      setLink(await track1Api.rotateTeamJoinLink(teamId));
      notify.success('Новая ссылка готова, старая больше не работает');
    } catch (error) {
      notify.error(errorText(error, 'Не получилось выпустить новую ссылку.'));
    } finally {
      setRotating(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Ссылка команды" subtitle={joinLinkHint(canRotate)}>
      {failed ? (
        <div className="pbth-stack pbth-center">
          <div className="pbth-muted">Ссылка не загрузилась.</div>
          <Button variant="glass2" block onClick={() => void load()}>
            Обновить
          </Button>
        </div>
      ) : !link ? (
        <div className="ui-skeleton" style={{ height: 220 }} aria-label="Загружаю ссылку" />
      ) : (
        <div className="pbth-stack">
          <div className="pbth-linkqr">
            <QrCode value={url} moduleSize={5} label={`QR-код ссылки команды ${teamName}`} />
          </div>
          <div className="pbth-center">
            <div className="pbth-small">Код команды</div>
            <p className="pbth-linkcode" data-testid="join-code">
              {link.code}
            </p>
          </div>
          <div className="pbth-linkurl" data-testid="join-url">
            {url}
          </div>
          <Button variant="light" block icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
          <Button variant="glass2" block icon="share-2" onClick={() => void share()}>
            Поделиться
          </Button>
          {canRotate && (
            <Button variant="glass2" block icon="refresh-cw" disabled={rotating} onClick={() => void rotate()}>
              Отозвать и выпустить новую
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
};
