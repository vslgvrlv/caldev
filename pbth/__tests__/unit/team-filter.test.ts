import { describe, expect, it } from 'vitest';
import {
  allHidden,
  filterGroups,
  filterKey,
  filterTeams,
  isTeamShown,
  parseHidden,
  playingTeamIds,
  pruneHidden,
  quickPick,
  requestsNoticeText,
  requestsNotices,
  requestTeams,
  creatableTeams,
  plusAction,
  serializeHidden,
  setTeamShown,
  showAll,
  showOnly,
  toggleTeam,
} from '../../lib/team-filter';
import { Role, type TeamContext } from '../../types';

const team = (teamId: string, role: Role, via?: 'membership' | 'owner'): TeamContext => ({
  membershipId: `m-${teamId}`,
  teamId,
  teamName: teamId.toUpperCase(),
  role,
  via,
});

const teams = [
  team('a', Role.CAPTAIN),
  team('b', Role.TRAINER),
  team('c', Role.PLAYER),
  team('d', Role.PLAYER, 'membership'),
  team('x', Role.CAPTAIN, 'owner'),
];

describe('фильтр команд: что показано', () => {
  it('по умолчанию показаны все: пустое множество выключенных', () => {
    const hidden = new Set<string>();
    for (const t of teams) expect(isTeamShown(hidden, t.teamId)).toBe(true);
  });

  it('тап выключает команду, второй тап включает обратно; исходное множество не меняется', () => {
    const start = new Set<string>();
    const off = toggleTeam(start, 'a');
    expect(isTeamShown(off, 'a')).toBe(false);
    expect(isTeamShown(off, 'b')).toBe(true);
    expect(start.size).toBe(0);
    const on = toggleTeam(off, 'a');
    expect(isTeamShown(on, 'a')).toBe(true);
    expect(on.size).toBe(0);
  });

  it('выключатель в шторке ставит состояние явно', () => {
    const off = setTeamShown(new Set(), 'c', false);
    expect([...off]).toEqual(['c']);
    expect(setTeamShown(off, 'c', false)).toBe(off);
    expect(setTeamShown(off, 'c', true).size).toBe(0);
  });

  it('новая команда, которой не было при выключении других, появляется включённой', () => {
    const hidden = new Set(['a', 'b']);
    expect(isTeamShown(hidden, 'new-team')).toBe(true);
  });

  it('в фильтре только свои команды; команды владельца платформы без членства не фильтруются', () => {
    expect(filterTeams(teams).map((t) => t.teamId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('все выключены — только когда выключены все свои команды; без команд — не «все скрыты»', () => {
    expect(allHidden(new Set(['a', 'b', 'c']), teams)).toBe(false);
    expect(allHidden(new Set(['a', 'b', 'c', 'd']), teams)).toBe(true);
    expect(allHidden(new Set(), [])).toBe(false);
  });
});

describe('фильтр команд: быстрый выбор', () => {
  it('«Все» — пустое множество', () => {
    expect(showAll().size).toBe(0);
  });

  it('«Играю» — команды, где я капитан или игрок; тренерство и чужие команды не входят', () => {
    expect(playingTeamIds(teams)).toEqual(['a', 'c', 'd']);
    const hidden = showOnly(teams, playingTeamIds(teams));
    expect([...hidden].sort()).toEqual(['b']);
  });

  it('какой сегмент отмечен: «Все», «Играю» или никакой, если набор ручной', () => {
    expect(quickPick(new Set(), teams)).toBe('all');
    expect(quickPick(new Set(['b']), teams)).toBe('playing');
    expect(quickPick(new Set(['a']), teams)).toBe('');
    // Все свои команды — игровые: «Играю» совпадает со «Все», отмечаем «Все».
    expect(quickPick(new Set(), [team('p', Role.PLAYER)])).toBe('all');
  });
});

describe('фильтр команд: хранение на устройстве', () => {
  it('ключ — отдельный для каждого человека', () => {
    expect(filterKey('u1')).not.toBe(filterKey('u2'));
    expect(filterKey('u1')).toContain('u1');
  });

  it('сериализация: выключенные id по порядку; разбор обратно', () => {
    const raw = serializeHidden(new Set(['c', 'a']));
    expect(raw).toBe('["a","c"]');
    expect([...parseHidden(raw)].sort()).toEqual(['a', 'c']);
  });

  it('пустое множество хранится пустым списком', () => {
    expect(serializeHidden(new Set())).toBe('[]');
    expect(parseHidden('[]').size).toBe(0);
  });

  it('мусор в хранилище — значит «показаны все», без падения', () => {
    for (const raw of [null, '', 'not json', '{"a":1}', '42', '[1,null,{}]']) {
      expect(parseHidden(raw as string | null).size).toBe(0);
    }
    expect([...parseHidden('["a",3,"b",""]')]).toEqual(['a', 'b']);
  });

  it('исчезнувшие команды вычищаются; если вычищать нечего — то же множество', () => {
    const hidden = new Set(['a', 'gone']);
    const pruned = pruneHidden(hidden, teams);
    expect([...pruned]).toEqual(['a']);
    const same = new Set(['a']);
    expect(pruneHidden(same, teams)).toBe(same);
  });

  it('пока список команд не загружен, ничего не вычищается', () => {
    const hidden = new Set(['a']);
    expect(pruneHidden(hidden, [])).toBe(hidden);
  });
});

describe('шторка «Команды»: группы по моей роли', () => {
  it('«Я капитан», «Я тренер», «Играю» — пустые группы не показываются', () => {
    const groups = filterGroups(teams);
    expect(groups.map((g) => [g.title, g.teams.map((t) => t.teamId)])).toEqual([
      ['Я капитан', ['a']],
      ['Я тренер', ['b']],
      ['Играю', ['c', 'd']],
    ]);
    expect(filterGroups([team('p', Role.PLAYER)]).map((g) => g.title)).toEqual(['Играю']);
  });
});

describe('строка заявок в ленте «Моё»', () => {
  it('склонение заявок и глагола', () => {
    expect(requestsNoticeText('Гроза', 1)).toBe('Гроза: 1 заявка ждёт ответа');
    expect(requestsNoticeText('Гроза', 2)).toBe('Гроза: 2 заявки ждут ответа');
    expect(requestsNoticeText('Гроза', 5)).toBe('Гроза: 5 заявок ждут ответа');
    expect(requestsNoticeText('Гроза', 21)).toBe('Гроза: 21 заявка ждёт ответа');
    expect(requestsNoticeText('Гроза', 11)).toBe('Гроза: 11 заявок ждут ответа');
  });
});

describe('заявки по командам', () => {
  it('спрашиваем только там, где я капитан или тренер, и только свои команды', () => {
    expect(requestTeams(teams).map((t) => t.teamId)).toEqual(['a', 'b']);
  });

  it('строка — на каждую включённую команду с заявками; выключенная и пустая не показываются', () => {
    const counts = { a: 2, b: 1, x: 5 };
    expect(requestsNotices(teams, counts, new Set()).map((n) => n.text)).toEqual([
      'A: 2 заявки ждут ответа',
      'B: 1 заявка ждёт ответа',
    ]);
    expect(requestsNotices(teams, counts, new Set(['a'])).map((n) => n.team.teamId)).toEqual(['b']);
    expect(requestsNotices(teams, { a: 0 }, new Set())).toEqual([]);
  });
});

describe('«плюс» на «Моё» и в «Календаре»', () => {
  it('создавать можно там, где я капитан или тренер; чужие команды владельца не в счёт', () => {
    expect(creatableTeams(teams).map((t) => t.teamId)).toEqual(['a', 'b']);
  });

  it('несколько команд — спросить; одна — сразу форма этой команды; ни одной — плюса нет', () => {
    expect(plusAction(teams)).toEqual({ kind: 'pick', teams: [teams[0], teams[1]] });
    expect(plusAction([teams[2], teams[1]])).toEqual({ kind: 'go', team: teams[1] });
    expect(plusAction([teams[2], teams[4]])).toEqual({ kind: 'none' });
  });
});
