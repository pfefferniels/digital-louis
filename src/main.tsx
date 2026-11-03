import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import {
  createBrowserRouter,
  RouterProvider,
} from 'react-router-dom';
import { WorkRoute } from './WorkRoute.tsx';

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
      element: <WorkRoute />
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
