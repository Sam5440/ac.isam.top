import CopyBox from '@/components/CopyBox';

/** 题面样例区块：输入/输出成对展示，note（若有）作为说明附在组后。 */
export default function SamplesSection({ samples }) {
  if (!samples?.length) return null;
  return (
    <section className="space-y-4">
      <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">样例</h3>
      {samples.map((s, i) => (
        <div key={i} className="space-y-2">
          {s.input != null && <CopyBox label={`Input #${i + 1}`} text={s.input} />}
          {s.output != null && <CopyBox label={`Output #${i + 1}`} text={s.output} tone="green" />}
          {s.note ? (
            <div className="text-muted-foreground md-body text-sm" dangerouslySetInnerHTML={{ __html: s.note }} />
          ) : null}
        </div>
      ))}
    </section>
  );
}
