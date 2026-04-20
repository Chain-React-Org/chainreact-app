import { ConnectionsContent } from "@/components/connections/ConnectionsContent"
import { PagePreloader } from "@/components/common/PagePreloader"

export default function AppsPage() {
  return (
    <PagePreloader
      pageType="apps"
      loadingTitle="Loading Connections"
      loadingDescription="Loading your connected integrations..."
      skipWorkflows={false}
    >
      <ConnectionsContent />
    </PagePreloader>
  )
}
