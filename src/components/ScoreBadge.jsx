import { percent, scoreTone } from '../lib/format.js'
export default function ScoreBadge({ score }) {
  return <span className={`score-badge score-${scoreTone(score)}`}>{percent(score)}</span>
}
