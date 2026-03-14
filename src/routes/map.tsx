import { createFileRoute } from '@tanstack/react-router'
import MapPage from '../features/map/MapPage'

export const Route = createFileRoute('/map')({
  head: () => ({
    meta: [
      {
        title: 'Weather Guardians Map',
      },
    ],
  }),
  component: MapRoute,
})

export function MapRoute() {
  return <MapPage />
}
