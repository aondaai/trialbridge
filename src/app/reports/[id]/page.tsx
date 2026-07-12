import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportGenerator } from "@/components/ReportGenerator";
import { TopBar } from "@/components/ui";
import { getConsultation, newReportRun, updateConsultationReportRun } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const consultation = await getConsultation(id);
  if (!consultation) notFound();
  const reportRun=consultation.reportRun??newReportRun(consultation.id);
  if(!consultation.reportRun) await updateConsultationReportRun(consultation.id,reportRun);

  return (
    <>
      <TopBar active="reports" />
      <main className="wrap">
        <p><Link href="/reports">← All reports</Link></p>
        <h1 style={{ marginBottom: 2 }}>{consultation.title}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {consultation.nct ? `${consultation.nct} · ` : ""}{consultation.criteria.length} eligibility criteria
        </p>
        <ReportGenerator
          consultationId={consultation.id}
          initialRun={reportRun}
        />
      </main>
    </>
  );
}
