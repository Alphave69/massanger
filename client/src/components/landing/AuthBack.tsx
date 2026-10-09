import { ArrowLeft } from 'lucide-react'
import { Link } from './Link'

/** Над формой входа на сайте: вернуться на главную (лендинг) */
export function AuthBack({ hidden }: { hidden?: boolean }) {
  return (
    <div className={`auth-home${hidden ? ' is-hidden' : ''}`}>
      <Link to="home" back className="dl-back">
        <ArrowLeft size={16} />
        <span>На главную</span>
      </Link>
    </div>
  )
}
