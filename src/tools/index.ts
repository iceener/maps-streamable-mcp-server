import { getPlace } from './get-place';
import { getRoute } from './get-route';
import { searchPlaces } from './search-places';

/** Every tool, in the order clients list them. The order is part of the published contract. */
export const tools = [searchPlaces, getPlace, getRoute];
