import { cn } from "@/lib/utils"
import { NetsuIcon } from "@/components/ui/netsu-icon"
import { useTranslation } from "react-i18next"

function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  const { t } = useTranslation("common")
  return (
    <span data-slot="spinner" role="status" aria-label={t("status.loading")} className={cn("inline-flex size-4 shrink-0", className)} {...props}>
      <NetsuIcon name="loading" busy className="size-full" />
    </span>
  )
}

export { Spinner }
