import { useMemo, useRef } from "react";
import { createDocumentRepository } from "../domain/documents/documentRepository";
import { useDashboard } from "../state/DashboardContext";

/**
 * React application adapter for the transitional document repository.
 * It supplies current DashboardContext commands without making the repository
 * itself depend on React or turning it into a process-wide singleton.
 */
export function useDocumentRepository() {
  const {
    state,
    addNote,
    updateNote,
    removeNote,
    updateObject,
    removeObject
  } = useDashboard();
  const stateRef = useRef(state);
  stateRef.current = state;

  return useMemo(() => createDocumentRepository({
    getState: () => stateRef.current,
    addNote,
    updateNote,
    updateNativeObject: updateObject,
    removeNote,
    removeNativeObject: removeObject
  }), [addNote, removeNote, removeObject, updateNote, updateObject]);
}
