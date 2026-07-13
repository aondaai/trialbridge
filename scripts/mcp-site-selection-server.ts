import { getConsultation } from "@/lib/store";
import { serveSelection } from "@/lib/feasibility-autofill/mcp/selectionServer";

serveSelection(async (consultationId) => await getConsultation(consultationId));
