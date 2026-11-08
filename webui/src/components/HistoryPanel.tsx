import { cn } from "@/lib/utils"

/** Geçmiş: adımlardan birine tıklayınca görüntü o ana döner, sonrasındaki adımlar soluk kalır. */
export function HistoryPanel({ rows, at, go }: { rows: string[]; at: number; go: (i: number) => void }) {
  return (
    <div className="space-y-px">
      {rows.map((name, i) => (
        <button key={i} onClick={() => go(i)} className={cn("flex w-full items-center rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-accent", i === at ? "bg-primary/20 text-foreground" : i > at ? "text-muted-foreground/50" : "text-muted-foreground")}>{name}</button>
      ))}
      <p className="pt-2 text-[10px] text-muted-foreground">Son 100 adım saklanır. Yeni bir düzenleme yaparsan soluk adımlar silinir.</p>
    </div>
  )
}
