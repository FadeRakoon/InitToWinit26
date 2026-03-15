export interface CountryBoundary {
  iso3: string
  name: string
  polygons: Array<Array<[number, number]>>
}

function createBoundingPolygon(
  west: number,
  south: number,
  east: number,
  north: number,
): Array<[number, number]> {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]
}

export const CARIBBEAN_COUNTRY_BOUNDARIES: CountryBoundary[] = [
  {
    iso3: 'ATG',
    name: 'Antigua and Barbuda',
    polygons: [createBoundingPolygon(-61.95, 16.9, -61.62, 17.82)],
  },
  {
    iso3: 'BHS',
    name: 'Bahamas',
    polygons: [createBoundingPolygon(-79.35, 20.8, -72.55, 27.15)],
  },
  {
    iso3: 'BRB',
    name: 'Barbados',
    polygons: [createBoundingPolygon(-59.68, 13.02, -59.4, 13.36)],
  },
  {
    iso3: 'CUB',
    name: 'Cuba',
    polygons: [createBoundingPolygon(-84.96, 19.6, -74.1, 23.4)],
  },
  {
    iso3: 'DMA',
    name: 'Dominica',
    polygons: [createBoundingPolygon(-61.5, 15.14, -61.2, 15.72)],
  },
  {
    iso3: 'DOM',
    name: 'Dominican Republic',
    polygons: [createBoundingPolygon(-72.1, 17.45, -68.2, 19.95)],
  },
  {
    iso3: 'GRD',
    name: 'Grenada',
    polygons: [createBoundingPolygon(-61.82, 11.95, -61.35, 12.55)],
  },
  {
    iso3: 'HTI',
    name: 'Haiti',
    polygons: [createBoundingPolygon(-74.55, 18, -71.62, 20.1)],
  },
  {
    iso3: 'JAM',
    name: 'Jamaica',
    polygons: [createBoundingPolygon(-78.5, 17.55, -76.18, 18.55)],
  },
  {
    iso3: 'KNA',
    name: 'Saint Kitts and Nevis',
    polygons: [createBoundingPolygon(-62.9, 17.1, -62.4, 17.55)],
  },
  {
    iso3: 'LCA',
    name: 'Saint Lucia',
    polygons: [createBoundingPolygon(-61.1, 13.7, -60.82, 14.15)],
  },
  {
    iso3: 'TTO',
    name: 'Trinidad and Tobago',
    polygons: [createBoundingPolygon(-61.95, 10, -60.5, 11.4)],
  },
  {
    iso3: 'VCT',
    name: 'Saint Vincent and the Grenadines',
    polygons: [createBoundingPolygon(-61.35, 12.5, -61.05, 13.4)],
  },
]
