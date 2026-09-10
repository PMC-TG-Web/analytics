import type { Metadata } from "next";
import { MARKET_OUTLOOK_UPDATED_AT, marketIndicators, sectorOutlook, type MarketSignal } from "@/lib/marketOutlook";
import styles from "./market-outlook.module.css";

export const metadata: Metadata = { title: "Market Outlook | Analytics" };

const groups = ["Pipeline", "Current market", "Material costs", "Labor", "Financing"] as const;

const signalLabel: Record<MarketSignal, string> = {
  strong: "Strong", mixed: "Mixed", weak: "Weak", watch: "Watch",
};

export default function MarketOutlookPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>PARADISE MASONRY · MARKET INTELLIGENCE</p>
          <h1>Market Outlook</h1>
          <p className={styles.intro}>Leading indicators for deciding which work to chase, where demand is forming, and when cost pressure may reach the field.</p>
        </div>
        <div className={styles.asOf}><span>Snapshot</span><strong>{MARKET_OUTLOOK_UPDATED_AT}</strong><small>Source publication dates vary</small></div>
      </section>

      <section className={styles.signalStrip} aria-label="Current market signals">
        <Signal title="Architect activity" signal="weak" text="Weak" />
        <Signal title="Design contracts" signal="weak" text="Weak" />
        <Signal title="Construction planning" signal="strong" text="Strong" />
        <Signal title="Institutional planning" signal="strong" text="Strong" />
        <Signal title="Current market" signal="mixed" text="Mixed" />
        <Signal title="2027 outlook" signal="mixed" text="Sector dependent" />
      </section>

      <section className={styles.readout}>
        <div>
          <p className={styles.kicker}>THE READ</p>
          <h2>Planning is strong. Conversion is the constraint.</h2>
          <p>AIA data points to softer architecture billings and design contracts, especially in the Northeast. Dodge planning data is moving the other way, led by data centers and broad institutional growth. The gap argues for selectivity rather than a blanket assumption that construction is slowing.</p>
        </div>
        <div className={styles.actionBox}>
          <span>CHASE SIGNAL</span>
          <strong>Favor institutional and healthcare opportunities.</strong>
          <p>Be selective with manufacturing and financing-sensitive private commercial work. Validate national momentum against Pennsylvania and the Lancaster–Harrisburg–Reading–York corridor.</p>
        </div>
      </section>

      <section className={styles.sectors}>
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>SECTOR FORECAST</p><h2>Where the 2027 recovery may land</h2></div>
          <a href="https://www.aia.org/resource-center/july-2026-consensus-construction-forecast" target="_blank" rel="noreferrer">AIA forecast ↗</a>
        </div>
        <div className={styles.sectorGrid}>
          {sectorOutlook.map((sector) => (
            <article className={styles.sectorCard} key={sector.name}>
              <div><span className={`${styles.dot} ${styles[sector.signal]}`} />{sector.name}</div>
              <dl><dt>2026</dt><dd>{sector.value2026}</dd><dt>2027</dt><dd>{sector.value2027}</dd></dl>
              <p>{sector.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>INDICATOR BOARD</p><h2>Signals by decision horizon</h2></div>
          <div className={styles.legend}><span><i className={styles.strong} />Strong</span><span><i className={styles.mixed} />Mixed</span><span><i className={styles.weak} />Weak</span><span><i className={styles.watch} />Watch</span></div>
        </div>
        {groups.map((group) => (
          <section className={styles.group} key={group}>
            <h3>{group}</h3>
            <div className={styles.grid}>
              {marketIndicators.filter((indicator) => indicator.group === group).map((indicator) => (
                <article className={styles.card} key={indicator.name}>
                  <header><span className={`${styles.badge} ${styles[indicator.signal]}`}>{signalLabel[indicator.signal]}</span><span className={styles.lead}>{indicator.leadTime}</span></header>
                  <h4>{indicator.name}</h4>
                  <div className={styles.value}>{indicator.value}</div>
                  {indicator.change && <div className={styles.change}>{indicator.change}</div>}
                  <p className={styles.note}>{indicator.note}</p>
                  <dl className={styles.meta}><div><dt>Why</dt><dd>{indicator.why}</dd></div><div><dt>Geography</dt><dd>{indicator.geography}</dd></div></dl>
                  <footer><span>{indicator.period}</span><a href={indicator.sourceUrl} target="_blank" rel="noreferrer">{indicator.source} ↗</a></footer>
                </article>
              ))}
            </div>
          </section>
        ))}
      </section>

      <section className={styles.regional}>
        <div><p className={styles.kicker}>REGIONAL PRIORITY</p><h2>National direction, local decisions.</h2></div>
        <p>Whenever source detail exists, the page prioritizes <strong>Pennsylvania</strong>, then <strong>Lancaster, Harrisburg, Reading, and York</strong>. Cards explicitly identify national proxies so they are never mistaken for local demand.</p>
      </section>
      <p className={styles.disclaimer}>Signals support business planning and do not guarantee future construction volume. Proprietary AIA and Dodge detail is summarized from their published releases.</p>
    </main>
  );
}

function Signal({ title, signal, text }: { title: string; signal: MarketSignal; text: string }) {
  return <div className={styles.signal}><span className={`${styles.dot} ${styles[signal]}`} /><div><small>{title}</small><strong>{text}</strong></div></div>;
}
