import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  text: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, text, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={25} /></div>
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

