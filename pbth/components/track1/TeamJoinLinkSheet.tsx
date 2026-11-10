import React from 'react';
import { Check, Copy, Loader2, RefreshCw, Share2, X } from 'lucide-react';
import { joinUrl, track1Api, type TeamJoinLink } from '../../api/track1';
import { confirmAction, errorText, notify } from '../../lib/notify';
import { QrCode } from './QrCode';

// Ссылка команды для капитана (трек 1): ссылка, код, QR, «Поделиться»,
// «Отозвать и выпустить новую». Ссылка постоянная: по ней не вступают сразу,
// а подают заявку — её принимает капитан или тренер.

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ниже запасной путь
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export const TeamJoinLinkSheet: React.FC<{ teamId: string; teamName: string; onClose: () => void }> = ({
  teamId,
  teamName,
  onClose,
}) => {
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
    // Выше нижнего меню и кнопки «+» (z-40): иначе они закрывают низ листа.
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-pb-surface border-t border-white/10 rounded-t-2xl p-4 text-white max-h-[92vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(var(--pb-safe-bottom) + 1rem)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Ссылка команды"
      >
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="font-bold text-lg">Ссылка команды</div>
            <div className="text-xs text-pb-subtext">По ней подают заявку, принимаешь ты или тренер.</div>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 -mt-1 text-pb-subtext" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        {failed ? (
          <div className="py-6 text-center text-sm text-pb-subtext">
            Ссылка не загрузилась.{' '}
            <button className="text-pb-primary font-semibold" onClick={() => void load()}>
              Обновить
            </button>
          </div>
        ) : !link ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-pb-primary" size={28} />
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex justify-center">
              <QrCode value={url} moduleSize={5} label={`QR-код ссылки команды ${teamName}`} />
            </div>
            <div className="text-center">
              <div className="text-xs text-pb-subtext">Код команды</div>
              <div className="text-2xl font-bold tracking-widest" data-testid="join-code">
                {link.code}
              </div>
            </div>
            <button
              onClick={() => void copy()}
              className="w-full flex items-center gap-2 rounded-xl bg-black/30 px-3 py-3 text-left text-sm"
            >
              <span className="flex-1 truncate text-pb-subtext" data-testid="join-url">
                {url}
              </span>
              {copied ? <Check size={16} className="text-pb-primary shrink-0" /> : <Copy size={16} className="shrink-0" />}
            </button>
            <button
              onClick={() => void share()}
              className="w-full bg-pb-primary text-pb-background font-bold py-3 rounded-xl flex items-center justify-center gap-2"
            >
              <Share2 size={18} />
              Поделиться
            </button>
            <button
              onClick={() => void rotate()}
              disabled={rotating}
              className="w-full bg-white/5 text-red-300 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {rotating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Отозвать и выпустить новую
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
