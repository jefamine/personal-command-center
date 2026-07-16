import { EyeOff, GripVertical, Maximize2, Pencil } from "lucide-react";
import { useState, type CSSProperties, type DragEvent, type PointerEvent, type ReactNode } from "react";
import { widgetGridHeight, widgetGridWidth, widgetMinGridWidth } from "../lib/widgetLayout";
import type { DashboardWidget } from "../types";

interface DashboardCanvasProps {
  widgets: DashboardWidget[];
  editing: boolean;
  renderWidget: (widget: DashboardWidget) => ReactNode;
  onMove: (sourceId: string, targetId: string) => void;
  onResize: (id: string, width: number, height: number) => void;
  onHide: (id: string) => void;
  onEdit: (id: string) => void;
}

interface ResizePreview {
  id: string;
  width: number;
  height: number;
}

export function DashboardCanvas({ widgets, editing, renderWidget, onMove, onResize, onHide, onEdit }: DashboardCanvasProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);

  const drop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    if (draggedId && draggedId !== targetId) onMove(draggedId, targetId);
    setDraggedId(null);
    setDropTargetId(null);
  };

  const startResize = (event: PointerEvent<HTMLButtonElement>, widget: DashboardWidget) => {
    event.preventDefault();
    event.stopPropagation();
    const grid = event.currentTarget.closest(".dashboard-widget-grid") as HTMLElement | null;
    if (!grid) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = widgetGridWidth(widget);
    const minWidth = widgetMinGridWidth(widget);
    const startHeight = widgetGridHeight(widget);
    const gridWidth = grid.getBoundingClientRect().width;
    const columnStep = (gridWidth - 11 * 12) / 12 + 12;
    const rowStep = 64;
    let finalWidth = startWidth;
    let finalHeight = startHeight;

    const move = (pointer: globalThis.PointerEvent) => {
      finalWidth = Math.min(12, Math.max(minWidth, startWidth + Math.round((pointer.clientX - startX) / columnStep)));
      finalHeight = Math.min(14, Math.max(2, startHeight + Math.round((pointer.clientY - startY) / rowStep)));
      setResizePreview({ id: widget.id, width: finalWidth, height: finalHeight });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      setResizePreview(null);
      onResize(widget.id, finalWidth, finalHeight);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  return (
    <div className={`dashboard-widget-grid ${editing ? "is-editing" : ""}`}>
      {widgets.map((widget) => {
        const width = resizePreview?.id === widget.id ? resizePreview.width : widgetGridWidth(widget);
        const height = resizePreview?.id === widget.id ? resizePreview.height : widgetGridHeight(widget);
        const style = { "--widget-columns": width, "--widget-rows": height, "--widget-render-rows": editing ? height + 1 : height } as CSSProperties;
        return (
          <div
            className={`widget-slot widget-type-${widget.type} ${draggedId === widget.id ? "is-dragging" : ""} ${dropTargetId === widget.id ? "is-drop-target" : ""}`}
            key={widget.id}
            style={style}
            onDragOver={(event) => {
              if (!editing || !draggedId) return;
              event.preventDefault();
              setDropTargetId(widget.id);
            }}
            onDragLeave={() => { if (dropTargetId === widget.id) setDropTargetId(null); }}
            onDrop={(event) => drop(event, widget.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onEdit(widget.id);
            }}
          >
            {editing ? (
              <div className="widget-edit-controls">
                <button
                  type="button"
                  className="widget-drag-handle"
                  draggable
                  onDragStart={(event) => {
                    setDraggedId(widget.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", widget.id);
                  }}
                  onDragEnd={() => { setDraggedId(null); setDropTargetId(null); }}
                  aria-label={`Переместить ${widget.title}`}
                  title="Перетащить карточку"
                >
                  <GripVertical size={16} />
                  <span>{widget.title}</span>
                </button>
                <span className="widget-grid-size">{width}×{height}</span>
                <button type="button" className="widget-control-button" onClick={() => onEdit(widget.id)} aria-label={`Редактировать ${widget.title}`} title="Редактировать карточку"><Pencil size={15} /></button>
                <button type="button" className="widget-control-button" onClick={() => onHide(widget.id)} aria-label={`Скрыть ${widget.title}`} title="Скрыть карточку"><EyeOff size={15} /></button>
              </div>
            ) : null}
            {!editing ? <button type="button" className="widget-quick-edit" onClick={() => onEdit(widget.id)} aria-label={`Редактировать ${widget.title}`} title="Редактировать виджет"><Pencil size={16} /></button> : null}
            <div className="widget-frame-content">{renderWidget(widget)}</div>
            {editing ? <button type="button" className="widget-resize-handle" onPointerDown={(event) => startResize(event, widget)} aria-label={`Изменить размер ${widget.title}`} title="Потяните, чтобы изменить размер"><Maximize2 size={16} /></button> : null}
          </div>
        );
      })}
    </div>
  );
}
