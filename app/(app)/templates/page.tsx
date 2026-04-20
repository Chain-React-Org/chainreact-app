import { LibraryContent } from "@/components/templates/library/LibraryContent"
import { PagePreloader } from "@/components/common/PagePreloader"

export default function LibraryPage() {
  return (
    <PagePreloader
      pageType="templates"
      loadingTitle="Loading Templates"
      loadingDescription="Loading workflow templates and your connected apps..."
      skipWorkflows={true}
    >
      <LibraryContent />
    </PagePreloader>
  )
}
