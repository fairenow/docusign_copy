import { CheckCircle2, AlertCircle } from 'lucide-react'

export default function SendChecklist({ problems }) {
  return (
    <section>
      <h2 className="section-heading mb-2">Ready to send?</h2>
      {problems.length === 0 ? (
        <p className="text-sm text-green-300 flex items-center gap-2"><CheckCircle2 size={14} /> Everything is in place.</p>
      ) : (
        <ul className="space-y-1" data-testid="send-problems">
          {problems.map(p => (
            <li key={p} className="text-xs text-amber-300 flex gap-2"><AlertCircle size={12} className="mt-0.5 flex-shrink-0" />{p}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
