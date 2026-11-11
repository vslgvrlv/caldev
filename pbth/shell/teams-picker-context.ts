import { createContext, useContext } from 'react';

/** Открывает выбор команд (шторка `TeamsPicker`). Даёт оболочка экранам в новом виде. */
export const TeamsPickerContext = createContext<() => void>(() => {});

export const useOpenTeams = () => useContext(TeamsPickerContext);
