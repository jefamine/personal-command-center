import {
  Check,
  Download,
  FileDown,
  HardDrive,
  Layers3,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload
} from "lucide-react";
import { useRef, useState } from "react";
import { downloadBackup, downloadMarkdownExport, readBackup } from "../lib/storage";
import { PersonalContextPanel } from "../components/PersonalContextPanel";
import { DataSafetyPanel } from "../components/DataSafetyPanel";
import { useDashboard } from "../state/DashboardContext";
import type {
  AccentPreset,
  CornerStyle,
  EnergyLevel,
  FontScale,
  InterfaceDensity,
  SurfaceTone,
  VisualStyle
} from "../types";

const palettes: Array<{
  id: Exclude<AccentPreset, "custom">;
  name: string;
  description: string;
  accent: string;
  secondary: string;
  surface: SurfaceTone;
}> = [
  { id: "lime", name: "Pulse", description: "Свежий и собранный", accent: "#cfee45", secondary: "#7c6cff", surface: "warm" },
  { id: "violet", name: "Cosmos", description: "Спокойный фокус", accent: "#9b87ff", secondary: "#55d6be", surface: "neutral" },
  { id: "ocean", name: "Ocean", description: "Чистый и воздушный", accent: "#53c7e8", secondary: "#637bff", surface: "cool" },
  { id: "coral", name: "Sunset", description: "Тёплый и живой", accent: "#ff8a68", secondary: "#ffca58", surface: "warm" },
  { id: "rose", name: "Bloom", description: "Мягкий и выразительный", accent: "#f17eb8", secondary: "#8c7cff", surface: "neutral" }
];

export function SettingsView() {
  const { state, updateSettings, replaceState } = useDashboard();
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const applyPalette = (palette: (typeof palettes)[number]) => {
    updateSettings({
      accentPreset: palette.id,
      accentColor: palette.accent,
      secondaryColor: palette.secondary,
      surfaceTone: palette.surface
    });
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const imported = await readBackup(file);
      replaceState(imported);
      setMessage("Резервная копия восстановлена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось прочитать файл.");
    }
  };

  return (
    <div className="page settings-page">
      <section className="page-heading">
        <div><span className="eyebrow">Ваш ритм, стиль и данные</span><h1>Настройки</h1><p>Сделайте командный центр своим: от поведения планировщика до палитры и характера интерфейса.</p></div>
      </section>

      <section className="panel appearance-studio">
        <div className="appearance-studio-header">
          <div className="settings-icon appearance-icon"><Palette size={22} /></div>
          <div><span className="eyebrow"><Sparkles size={12} /> Персонализация</span><h2>Студия оформления</h2><p>Выберите настроение или соберите собственное. Всё меняется мгновенно и сохраняется локально.</p></div>
          <span className="live-badge"><i /> Живой предпросмотр</span>
        </div>

        <div className="appearance-layout">
          <div className="appearance-controls">
            <div className="appearance-block">
              <div className="appearance-block-title"><strong>Готовые палитры</strong><span>Цвета и тон фона</span></div>
              <div className="palette-grid">
                {palettes.map((palette) => (
                  <button
                    key={palette.id}
                    type="button"
                    className={state.settings.accentPreset === palette.id ? "active" : ""}
                    onClick={() => applyPalette(palette)}
                  >
                    <span className="palette-swatch" style={{ background: `linear-gradient(135deg, ${palette.accent} 0 52%, ${palette.secondary} 52%)` }} />
                    <span><strong>{palette.name}</strong><small>{palette.description}</small></span>
                    {state.settings.accentPreset === palette.id ? <Check size={14} /> : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="appearance-block">
              <div className="appearance-block-title"><strong>Свои цвета</strong><span>Главный и дополнительный акценты</span></div>
              <div className="custom-color-row">
                <label className="color-field">
                  <input type="color" value={state.settings.accentColor} onChange={(event) => updateSettings({ accentPreset: "custom", accentColor: event.target.value })} />
                  <span><strong>Главный</strong><small>{state.settings.accentColor.toUpperCase()}</small></span>
                </label>
                <label className="color-field">
                  <input type="color" value={state.settings.secondaryColor} onChange={(event) => updateSettings({ accentPreset: "custom", secondaryColor: event.target.value })} />
                  <span><strong>Дополнительный</strong><small>{state.settings.secondaryColor.toUpperCase()}</small></span>
                </label>
              </div>
            </div>

            <div className="appearance-block compact-block">
              <div className="appearance-block-title"><strong>Режим</strong><span>Свет, система или ночь</span></div>
              <div className="theme-segments">
                <button className={state.settings.theme === "light" ? "active" : ""} onClick={() => updateSettings({ theme: "light" })}><Sun size={15} /> Светлый</button>
                <button className={state.settings.theme === "system" ? "active" : ""} onClick={() => updateSettings({ theme: "system" })}><Monitor size={15} /> Система</button>
                <button className={state.settings.theme === "dark" ? "active" : ""} onClick={() => updateSettings({ theme: "dark" })}><Moon size={15} /> Тёмный</button>
              </div>
            </div>

            <div className="appearance-select-grid">
              <label><span>Характер панелей</span><select value={state.settings.visualStyle} onChange={(event) => updateSettings({ visualStyle: event.target.value as VisualStyle })}><option value="soft">Мягкий</option><option value="glass">Стеклянный</option><option value="contrast">Контрастный</option></select></label>
              <label><span>Тон фона</span><select value={state.settings.surfaceTone} onChange={(event) => updateSettings({ surfaceTone: event.target.value as SurfaceTone })}><option value="warm">Тёплый</option><option value="neutral">Нейтральный</option><option value="cool">Холодный</option></select></label>
              <label><span>Скругления</span><select value={state.settings.cornerStyle} onChange={(event) => updateSettings({ cornerStyle: event.target.value as CornerStyle })}><option value="rounded">Выразительные</option><option value="balanced">Сбалансированные</option><option value="crisp">Строгие</option></select></label>
              <label><span>Плотность</span><select value={state.settings.density} onChange={(event) => updateSettings({ density: event.target.value as InterfaceDensity })}><option value="comfortable">Комфортная</option><option value="compact">Компактная</option></select></label>
              <label><span>Размер текста</span><select value={state.settings.fontScale} onChange={(event) => updateSettings({ fontScale: event.target.value as FontScale })}><option value="normal">Увеличенный</option><option value="large">Крупный</option><option value="xlarge">Очень крупный</option></select></label>
            </div>
          </div>

          <div className="appearance-preview-wrap">
            <div className="appearance-preview-label"><Layers3 size={14} /><span>Так будет выглядеть рабочее пространство</span></div>
            <div className="appearance-preview">
              <aside><div className="preview-logo"><Sparkles size={13} /></div><i className="active" /><i /><i /><i /></aside>
              <div className="preview-main">
                <div className="preview-top"><i /><span /><span /></div>
                <div className="preview-heading"><span>Доброе утро</span><strong>Ваш день</strong></div>
                <div className="preview-stats"><i /><i /><i /></div>
                <div className="preview-focus"><span>Главный фокус</span><strong>Завершить важный результат</strong><span className="preview-button">Начать</span></div>
                <div className="preview-row"><i /><span><strong /><small /></span></div>
                <div className="preview-row"><i /><span><strong /><small /></span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PersonalContextPanel />

      <DataSafetyPanel />

      <div className="settings-grid">
        <section className="panel settings-section">
          <div className="settings-section-heading"><div className="settings-icon"><RotateCcw size={21} /></div><div><h2>Рабочий ритм</h2><p>Ограничения для реалистичного плана.</p></div></div>
          <div className="form-grid">
            <label><span>Как к вам обращаться</span><input value={state.settings.userName} onChange={(event) => updateSettings({ userName: event.target.value })} placeholder="Имя" /></label>
            <label><span>Текущая энергия</span><select value={state.settings.currentEnergy} onChange={(event) => updateSettings({ currentEnergy: event.target.value as EnergyLevel })}><option value="low">Низкая</option><option value="medium">Средняя</option><option value="high">Высокая</option></select></label>
            <label><span>Начало дня</span><input type="time" value={state.settings.workdayStart} onChange={(event) => updateSettings({ workdayStart: event.target.value })} /></label>
            <label><span>Конец дня</span><input type="time" value={state.settings.workdayEnd} onChange={(event) => updateSettings({ workdayEnd: event.target.value })} /></label>
            <label><span>Фокус в день, минут</span><input type="number" min="30" max="720" step="15" value={state.settings.dailyCapacityMinutes} onChange={(event) => updateSettings({ dailyCapacityMinutes: Number(event.target.value) })} /></label>
            <label><span>Фокус-блок, минут</span><input type="number" min="15" max="180" step="5" value={state.settings.focusBlockMinutes} onChange={(event) => updateSettings({ focusBlockMinutes: Number(event.target.value) })} /></label>
            <label><span>Буфер между блоками, минут</span><input type="number" min="0" max="60" step="5" value={state.settings.bufferMinutes} onChange={(event) => updateSettings({ bufferMinutes: Number(event.target.value) })} /></label>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="settings-section-heading"><div className="settings-icon"><HardDrive size={21} /></div><div><h2>Данные и резервные копии</h2><p>Приложение не отправляет их внешним сервисам автоматически.</p></div></div>
          <div className="local-data-card"><ShieldCheck size={23} /><div><strong>Основное хранение — на устройстве</strong><span>Локальное хранилище браузера IndexedDB; это не зашифрованный сейф</span></div></div>
          <p className="backup-privacy-note">JSON-копия содержит все данные, включая личные записи, профиль и память помощника, и читается как обычный файл. Храните её в подходящем вам месте.</p>
          <div className="backup-actions">
            <button className="secondary-button" onClick={() => downloadBackup(state)}><Download size={17} /> Скачать копию</button>
            <button className="secondary-button" onClick={() => downloadMarkdownExport(state)}><FileDown size={17} /> Экспорт Markdown</button>
            <button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={17} /> Восстановить</button>
            <input ref={fileInput} type="file" accept="application/json" hidden onChange={(event) => importFile(event.target.files?.[0])} />
          </div>
          {message ? <p className="settings-message">{message}</p> : null}
        </section>
      </div>
    </div>
  );
}
