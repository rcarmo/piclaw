interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className = "" }: IconProps) {
  const sizeClass = size === 24 ? "icon--size-24" : "icon--size-16";
  return (
    <i
      className={`codicon codicon-${name} ${sizeClass} ${className}`.trim()}
    />
  );
}
