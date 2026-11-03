import { useParams } from 'react-router-dom'
import Work from './Work'

/** The work a route names, as in /prelude7 */
export const WorkRoute = () => {
  const { workId } = useParams()
  if (!workId) return <p>not found</p>
  return <Work id={workId} />
}
