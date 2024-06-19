import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import {
  createBrowserRouter,
  RouterProvider,
  useParams,
} from 'react-router-dom';
import Work from './Work.tsx';

const WorkRouter = () => {
  const { workId } = useParams()
  if (!workId) return <p>not found</p>
  return <Work id={workId} />
}

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <App />,
    },
    {
      path: 'about',
      element: <div>About</div>,
    },
    {
      path: '/:workId',
      element: <WorkRouter />
    }
  ],
  {
    basename: import.meta.env.BASE_URL
  });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
