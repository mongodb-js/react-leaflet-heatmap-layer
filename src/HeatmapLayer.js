import React from 'react';
import map from 'lodash.map';
import reduce from 'lodash.reduce';
import filter from 'lodash.filter';
import min from 'lodash.min';
import minBy from 'lodash.minby';
import max from 'lodash.max';
import maxBy from 'lodash.maxby';
import isNumber from 'lodash.isnumber';
import L from 'leaflet';
import { MapLayer, withLeaflet } from 'react-leaflet';
import simpleheat from 'simpleheat';
import PropTypes from 'prop-types';

export type LngLat = {
  lng: number;
  lat: number;
}

export type Point = {
  x: number;
  y: number;
}

export type Bounds = {
  contains: (latLng: LngLat) => boolean;
}

export type Pane = {
  appendChild: (element: Object) => void;
}

export type Panes = {
  overlayPane: Pane;
}

export type Map = {
  layerPointToLatLng: (lngLat: Point) => LngLat;
  latLngToLayerPoint: (lngLat: LngLat) => Point;
  on: (event: string, handler: () => void) => void;
  getBounds: () => Bounds;
  getPanes: () => Panes;
  invalidateSize: () => void;
  options: Object;
}

export type LeafletZoomEvent = {
  zoom: number;
  center: Object;
}

type AggregateType = 'mean' | 'count' | 'sum' | 'distinct' | 'min' | 'max'
  | 'variance' | 'variancep' | 'stdev' | 'stdevp' ;

type Aggregation = {
  data: {
    mean: number,
    sigma: number,
    count: number,
    sum: number,
    distinct: number,
    min: number,
    max: number,
    variance: number,
    variancep: number,
    stdev: number,
    stdevp: number
  },
  same: Set,
  seen: number
};

function isInvalid(num: number): boolean {
  return !isNumber(num) && !num;
}

function isValid(num: number): boolean {
  return !isInvalid(num);
}

function isValidLatLngArray(arr: Array<number>): boolean {
  return filter(arr, isValid).length === arr.length;
}

function isInvalidLatLngArray(arr: Array<number>): boolean {
  return !isValidLatLngArray(arr);
}

function safeRemoveLayer(leafletMap: Map, el): void {
  const { overlayPane } = leafletMap.getPanes();
  if (overlayPane && overlayPane.contains(el)) {
    overlayPane.removeChild(el);
  }
}

function shouldIgnoreLocation(loc: LngLat): boolean {
  return isInvalid(loc.lng) || isInvalid(loc.lat);
}

export function computeAggregate(
  agg: Aggregation,
  intensity: number,
  aggregateType: AggregateType = 'sum'
): number {
  /* eslint-disable no-use-before-define */
  const updateMeanAndSigma = (m, c, v) => {
    const newMean = agg.data.mean + fns.mean(agg.data.mean, c, v);

    agg.data.sigma += (v - newMean) * (v - agg.data.mean);

    agg.data.mean = newMean;
  };

  /* eslint-disable no-unused-vars */
  const fns = {
    mean: (m, c, v) => (v - m) / c,
    count: (m, c, v) => 1,
    sum: (m, c, v) => v,
    distinct: (m, c, v) => {
      agg.same.add(v);
      return agg.same.size;
    },
    min: (m, c, v) => Math.min(m, v),
    max: (m, c, v) => Math.max(m, v),
    variance: (m, c, v) => {
      updateMeanAndSigma(m, c, v);
      return c > 1 ? agg.data.sigma / (c - 1) : 0;
    },
    variancep: (m, c, v) => {
      updateMeanAndSigma(m, c, v);
      return c > 1 ? agg.data.sigma / c : 0;
    },
    stdev: (m, c, v) => Math.sqrt(fns.variance(m, c, v)),
    stdevp: (m, c, v) => Math.sqrt(fns.variancep(m, c, v))
  };

  const type = aggregateType.toLowerCase();

  if (!agg.data[type]) {
    if (type === 'min') {
      agg.data[type] = Number.MAX_SAFE_INTEGER;
    } else if (type === 'max') {
      agg.data[type] = Number.MIN_SAFE_INTEGER;
    } else if (['stdev', 'stdevp', 'variance', 'variancep'].includes(type)) {
      if (!agg.data.mean) {
        agg.data.mean = 0;
      }

      if (!agg.data.sigma) {
        agg.data.sigma = 0;
      }

      agg.data[type] = 0;
    } else {
      agg.data[type] = 0;
    }
  }

  const res = (fns[type] || fns.sum)(agg.data[type], agg.seen, intensity);

  if (['mean', 'count', 'sum'].includes(type)) {
    agg.data[type] += res;
  } else {
    agg.data[type] = res;
  }

  return agg.data[type];
}

export default withLeaflet(class HeatmapLayer extends MapLayer {
  static propTypes = {
    points: PropTypes.array.isRequired,
    longitudeExtractor: PropTypes.func.isRequired,
    latitudeExtractor: PropTypes.func.isRequired,
    intensityExtractor: PropTypes.func.isRequired,
    fitBoundsOnLoad: PropTypes.bool,
    fitBoundsOnUpdate: PropTypes.bool,
    onStatsUpdate: PropTypes.func,
    /* props controlling heatmap generation */
    max: PropTypes.number,
    radius: PropTypes.number,
    maxZoom: PropTypes.number,
    minOpacity: PropTypes.number,
    useLocalExtrema: PropTypes.bool,
    blur: PropTypes.number,
    gradient: PropTypes.object,
    aggregateType: PropTypes.oneOf([
      'mean', 'count', 'sum', 'distinct', 'min', 'max',
      'variance', 'variancep', 'stdev', 'stdevp'
    ])
  };

  createLeafletElement() {
    return null;
  }

  componentDidMount(): void {
    const canAnimate = this.props.leaflet.map.options.zoomAnimation && L.Browser.any3d;
    const zoomClass = `leaflet-zoom-${canAnimate ? 'animated' : 'hide'}`;
    const mapSize = this.props.leaflet.map.getSize();
    const transformProp = L.DomUtil.testProp(
      ['transformOrigin', 'WebkitTransformOrigin', 'msTransformOrigin']
    );

    this._el = L.DomUtil.create('canvas', zoomClass);
    this._el.style[transformProp] = '50% 50%';
    this._el.width = mapSize.x;
    this._el.height = mapSize.y;

    const el = this._el;

    const Heatmap = L.Layer.extend({
      onAdd: (leafletMap) => leafletMap.getPanes().overlayPane.appendChild(el),
      addTo: (leafletMap) => {
        leafletMap.addLayer(this);
        return this;
      },
      onRemove: (leafletMap) => safeRemoveLayer(leafletMap, el)
    });

    this.leafletElement = new Heatmap();
    super.componentDidMount();
    this._heatmap = simpleheat(this._el);
    this.reset();

    if (this.props.fitBoundsOnLoad) {
      this.fitBounds();
    }

    this.attachEvents();
    this.updateHeatmapProps(this.getHeatmapProps(this.props));
  }

  getMax(props: Object): number {
    return isNumber(props.max) ? props.max : 3.0;
  }

  getRadius(props: Object): number {
    return isNumber(props.radius) ? props.radius : 30;
  }

  getMaxZoom(props: Object): number {
    return isNumber(props.maxZoom) ? props.maxZoom : 18;
  }

  getMinOpacity(props: Object): number {
    return isNumber(props.minOpacity) ? props.minOpacity : 0.01;
  }

  getBlur(props: Object): number {
    return isNumber(props.blur) ? props.blur : 15;
  }

  getHeatmapProps(props: Object): Object {
    return {
      minOpacity: this.getMinOpacity(props),
      maxZoom: this.getMaxZoom(props),
      radius: this.getRadius(props),
      blur: this.getBlur(props),
      max: this.getMax(props),
      gradient: props.gradient
    };
  }

  componentWillReceiveProps(nextProps: Object): void {
    const currentProps = this.props;
    const nextHeatmapProps = this.getHeatmapProps(nextProps);

    this.updateHeatmapGradient(nextHeatmapProps.gradient);

    const hasRadiusUpdated = nextHeatmapProps.radius !== currentProps.radius;
    const hasBlurUpdated = nextHeatmapProps.blur !== currentProps.blur;

    if (hasRadiusUpdated || hasBlurUpdated) {
      this.updateHeatmapRadius(nextHeatmapProps.radius, nextHeatmapProps.blur);
    }

    if (nextHeatmapProps.max !== currentProps.max) {
      this.updateHeatmapMax(nextHeatmapProps.max);
    }

  }

  /**
   * Update various heatmap properties like radius, gradient, and max
   */
  updateHeatmapProps(props: Object) {
    this.updateHeatmapRadius(props.radius, props.blur);
    this.updateHeatmapGradient(props.gradient);
    this.updateHeatmapMax(props.max);
  }

  /**
   * Update the heatmap's radius and blur (blur is optional)
   */
  updateHeatmapRadius(radius: number, blur: ?number): void {
    if (isNumber(radius)) {
      this._heatmap.radius(radius, blur);
    }
  }

  /**
   * Update the heatmap's gradient
   */
  updateHeatmapGradient(gradient: Object): void {
    if (gradient) {
      this._heatmap.gradient(gradient);
    }
  }

  /**
   * Update the heatmap's maximum
   */
  updateHeatmapMax(maximum: number): void {
    if (isNumber(maximum)) {
      this._heatmap.max(maximum);
    }
  }

  componentWillUnmount(): void {
    safeRemoveLayer(this.props.leaflet.map, this._el);
  }

  fitBounds(): void {
    const {
      points,
      leaflet,
      longitudeExtractor,
      latitudeExtractor
    } = this.props;

    const lngs = map(points, longitudeExtractor);
    const lats = map(points, latitudeExtractor);

    const ne = { lng: max(lngs), lat: max(lats) }
    const sw = { lng: min(lngs), lat: min(lats) }

    if (shouldIgnoreLocation(ne) || shouldIgnoreLocation(sw)) {
      return;
    }

    leaflet.map.fitBounds(L.latLngBounds(L.latLng(sw), L.latLng(ne)));
  }

  componentDidUpdate(): void {
    this.props.leaflet.map.invalidateSize();

    if (this.props.fitBoundsOnUpdate) {
      this.fitBounds();
    }

    this.reset();
  }

  shouldComponentUpdate(): boolean {
    return true;
  }

  attachEvents(): void {
    const leafletMap: Map = this.props.leaflet.map;
    leafletMap.on('viewreset', () => this.reset());
    leafletMap.on('moveend', () => this.reset());
    if (leafletMap.options.zoomAnimation && L.Browser.any3d) {
      leafletMap.on('zoomanim', this._animateZoom, this);
    }
  }

  _animateZoom(e: LeafletZoomEvent): void {
    const scale = this.props.leaflet.map.getZoomScale(e.zoom);
    const offset = this.props.leaflet.map
                      ._getCenterOffset(e.center)
                      ._multiplyBy(-scale)
                      .subtract(this.props.leaflet.map._getMapPanePos());

    if (L.DomUtil.setTransform) {
      L.DomUtil.setTransform(this._el, offset, scale);
    } else {
      this._el.style[L.DomUtil.TRANSFORM] =
          `${L.DomUtil.getTranslateString(offset)} scale(${scale})`;
    }
  }

  reset(): void {
    const topLeft = this.props.leaflet.map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._el, topLeft);

    const size = this.props.leaflet.map.getSize();

    if (this._heatmap._width !== size.x) {
      this._el.width = this._heatmap._width = size.x;
    }
    if (this._heatmap._height !== size.y) {
      this._el.height = this._heatmap._height = size.y;
    }

    if (this._heatmap && !this._frame && !this.props.leaflet.map._animating) {
      this._frame = L.Util.requestAnimFrame(this.redraw, this);
    }

    this.redraw();
  }

  redraw(): void {
    const r = this._heatmap._r;
    const size = this.props.leaflet.map.getSize();
    const cellSize = r / 2;
    const panePos = this.props.leaflet.map._getMapPanePos();
    const offsetX = panePos.x % cellSize;
    const offsetY = panePos.y % cellSize;
    const getLat = this.props.latitudeExtractor;
    const getLng = this.props.longitudeExtractor;
    const getIntensity = this.props.intensityExtractor;

    const inBounds = (p, bounds) => bounds.contains(p);

    const filterUndefined = (row) => filter(row, c => c !== undefined);

    const roundResults = (results) => reduce(results, (result, row) =>
      map(filterUndefined(row), (cell) => [
        Math.round(cell[0]),
        Math.round(cell[1]),
        cell[2]
      ]).concat(result),
      []
    );

    const aggregates = {};

    const accumulateInGrid = (points, leafletMap, bounds, aggregateType) =>
      reduce(points, (grid, point) => {
        const latLng = [getLat(point), getLng(point)];

        //skip invalid points
        if (isInvalidLatLngArray(latLng)) {
          return grid;
        }

        const p = leafletMap.latLngToContainerPoint(latLng);

        if (!inBounds(p, bounds)) {
          return grid;
        }

        const x = Math.floor((p.x - offsetX) / cellSize) + 2;
        const y = Math.floor((p.y - offsetY) / cellSize) + 2;

        grid[y] = grid[y] || [];
        const cell = grid[y][x];

        const key = `${x}-${y}`;

        if (!aggregates[key]) {
          aggregates[key] = {
            data: {},
            same: new Set(),
            seen: 0
          };
        }

        aggregates[key].seen++;

        const intensity = getIntensity(point);
        const agg = computeAggregate(aggregates[key], intensity, aggregateType);

        if (!cell) {
          grid[y][x] = [p.x, p.y, agg];
        } else {
          cell[0] = (cell[0] * cell[2] + p.x * agg) / (cell[2] + agg); // x
          cell[1] = (cell[1] * cell[2] + p.y * agg) / (cell[2] + agg); // y
          cell[2] = agg;
        }

        return grid;
      },
      []
    );

    const getBounds = () => new L.Bounds(L.point([-r, -r]), size.add([r, r]));

    const getDataForHeatmap = (points, leafletMap, aggregateType) => roundResults(
      accumulateInGrid(
        points,
        leafletMap,
        getBounds(leafletMap),
        aggregateType
      )
    );

    const data = getDataForHeatmap(
      this.props.points,
      this.props.leaflet.map,
      this.props.aggregateType
    );

    const totalMax = maxBy(data, m => m[2])[2];

    this._heatmap.clear();
    this._heatmap.data(data);

    if (this.props.useLocalExtrema) {
      this.updateHeatmapMax(totalMax);
    }

    this._heatmap.draw(this.getMinOpacity(this.props));

    this._frame = null;

    if (this.props.onStatsUpdate && this.props.points && this.props.points.length > 0) {
      this.props.onStatsUpdate({
        min: minBy(data, m => m[2])[2],
        max: totalMax
      });
    }
  }


  render(): React.Element {
    return null;
  }

});
