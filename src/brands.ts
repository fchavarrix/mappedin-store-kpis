// Peruvian brands placed on the Lower Level stores of Mappedin's demo mall, with the logos of the
// Theme Trails demo. Illustrative only: the brands do not take part in or endorse this demo, and
// every figure is simulated. In a real deployment this file would come from the mall's CMS.

export type Category =
  | 'super'
  | 'hogar'
  | 'moda'
  | 'calzado'
  | 'alpaca'
  | 'tecno'
  | 'farmacia'
  | 'belleza'
  | 'restaurante'
  | 'rapida'
  | 'cafe'
  | 'chocolates'
  | 'libreria'
  | 'barrio';

export type Brand = {
  id: string;
  name: string;
  logo: string;
  /** Name of the store in the demo map that this brand takes over. */
  store: string;
  category: Category;
  /** White logos need a dark badge. */
  dark?: boolean;
};

export const brands: Brand[] = [
  { id: 'plazavea', name: 'Plaza Vea', logo: 'plazavea.png', store: 'Nordstorm', category: 'super' },
  { id: 'promart', name: 'Promart', logo: 'promart.png', store: 'Bloomingdales', category: 'hogar' },
  { id: 'topitop', name: 'Topitop', logo: 'topitop.svg', store: 'H&M', category: 'moda' },
  { id: 'platanitos', name: 'Platanitos', logo: 'platanitos.svg', store: "Victoria's Secret", category: 'calzado' },
  { id: 'kuna', name: 'Kuna', logo: 'kuna.svg', store: 'Radiance', category: 'alpaca', dark: true },
  { id: 'hiraoka', name: 'Hiraoka', logo: 'hiraoka.png', store: 'Reebok', category: 'tecno' },
  { id: 'coolbox', name: 'Coolbox', logo: 'coolbox.png', store: 'True Religion', category: 'tecno' },
  { id: 'inkafarma', name: 'Inkafarma', logo: 'inkafarma.svg', store: 'Shoppers Drug Mart', category: 'farmacia' },
  { id: 'esika', name: 'Ésika', logo: 'esika.png', store: 'Saje Natural Wellness', category: 'belleza' },
  { id: 'tanta', name: 'Tanta', logo: 'tanta.png', store: 'Bourbon Street Grill', category: 'restaurante' },
  { id: 'pardos', name: 'Pardos Chicken', logo: 'pardos.png', store: 'White Barn', category: 'restaurante' },
  { id: 'bembos', name: 'Bembos', logo: 'bembos.svg', store: 'Kernels', category: 'rapida' },
  { id: 'rokys', name: "Roky's", logo: 'rokys.svg', store: 'Endy', category: 'rapida' },
  { id: 'chinawok', name: 'Chinawok', logo: 'chinawok.svg', store: 'The Barber Shop', category: 'rapida' },
  { id: 'lalucha', name: 'La Lucha', logo: 'lalucha.svg', store: 'Q Nails', category: 'rapida', dark: true },
  { id: 'sanantonio', name: 'San Antonio', logo: 'sanantonio.png', store: 'Petit Pont', category: 'cafe' },
  { id: 'donmamino', name: 'Don Mamino', logo: 'donmamino.png', store: 'Torrid', category: 'cafe' },
  { id: 'helena', name: 'Helena Chocolatier', logo: 'helena.png', store: 'Lindt', category: 'chocolates' },
  { id: 'tailoy', name: 'Tai Loy', logo: 'tailoy.svg', store: 'Ardene', category: 'libreria' },
  { id: 'mass', name: 'Mass', logo: 'mass.webp', store: 'Gap', category: 'barrio' },
];
