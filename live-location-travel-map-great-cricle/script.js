// ==UserScript==
// @name        Torn Location Based Travel Map (Great Circle)
// @namespace   http://tampermonkey.net/
// @version     2025-12-04-gc
// @description Replaces the plane in torn travel page with a live location map using great circle paths
// @author      justlucdewit and Woeka
// @match       https://www.torn.com/page.php?sid=travel
// @icon        https://www.google.com/s2/favicons?sz=64&domain=torn.com
// ==/UserScript==

(function() {
    'use strict';

    // Convert map coordinates (percentage) to lat/lon
    const mapToLatLon = (x, y) => {
        // Assuming the map is a standard equirectangular projection
        // x: 0-100 maps to longitude -180 to 180
        // y: 0-100 maps to latitude 90 to -90 (inverted)
        const lon = (x / 100) * 360 - 180;
        const lat = 90 - (y / 100) * 180;
        return { lat, lon };
    };

    // Convert lat/lon back to map coordinates
    const latLonToMap = (lat, lon) => {
        const x = ((lon + 180) / 360) * 100;
        const y = ((90 - lat) / 180) * 100;
        return { x, y };
    };

    // Convert degrees to radians
    const toRad = (deg) => deg * Math.PI / 180;
    const toDeg = (rad) => rad * 180 / Math.PI;

    // Calculate great circle path between two points
    const greatCirclePath = (start, end, numPoints = 50) => {
        const lat1 = toRad(start.lat);
        const lon1 = toRad(start.lon);
        const lat2 = toRad(end.lat);
        const lon2 = toRad(end.lon);

        const points = [];

        for (let i = 0; i <= numPoints; i++) {
            const fraction = i / numPoints;

            // Spherical interpolation
            const d = 2 * Math.asin(Math.sqrt(
                Math.pow(Math.sin((lat1 - lat2) / 2), 2) +
                Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lon1 - lon2) / 2), 2)
            ));

            const a = Math.sin((1 - fraction) * d) / Math.sin(d);
            const b = Math.sin(fraction * d) / Math.sin(d);

            const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
            const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
            const z = a * Math.sin(lat1) + b * Math.sin(lat2);

            const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
            const lon = Math.atan2(y, x);

            points.push({ lat: toDeg(lat), lon: toDeg(lon) });
        }

        return points;
    };

    const render_frame = (canvas, ctx) => {
        const canvas_width = canvas.getBoundingClientRect().width;
        const canvas_height = canvas.getBoundingClientRect().height;
        canvas.width = canvas_width;
        canvas.height = canvas_height;

        ctx.clearRect(0, 0, canvas_width, canvas_height);

        const locations = {
            'torn': { 'x': 51, 'y': 47 },
            'mexico': { 'x': 48, 'y': 49 },
            'cayman-islands': { 'x': 54, 'y': 52 },
            'canada': { 'x': 54, 'y': 38 },
            'hawaii': { 'x': 34, 'y': 53 },
            'uk': { 'x': 77, 'y': 31 },
            'argentina': { 'x': 60, 'y': 83 },
            'switzerland': { 'x': 79, 'y': 36 },
            'japan': { 'x': 16, 'y': 42 },
            'uae': { 'x': 92, 'y': 49 },
            'china': { 'x': 9, 'y': 39 },
            'south-africa': { 'x': 85, 'y': 78 },
        }

        // Draw location dots
        ctx.fillStyle = '#FF0000AA';
        Object.entries(locations).forEach(([name, loc]) => {
            const real_x = canvas.width / 100 * loc.x;
            const real_y = canvas.height / 100 * loc.y;

            ctx.beginPath();
            ctx.arc(real_x, real_y, 5, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.fill();
        });

        // Calculate flight percentage
        const flight_progress_bar = document.querySelector('div[class^="flightProgressBar__"]');
        let flight_percentage = flight_progress_bar.querySelector('div[class^="fill__"]').style.width;
        flight_percentage = Number(flight_percentage.slice(0, flight_percentage.length - 1))

        // Calculate destination and departure country
        const country_wrapper = document.querySelector('div[class^="nodesAndProgress___"]');
        let countries = [...country_wrapper.querySelectorAll('img[class^="circularFlag___"]')];
        const fillHead = country_wrapper.querySelector('img[class^="fillHead___"]');

        if (fillHead.style.left) {
            countries = countries.reverse();
        }

        const destination = countries[0].src.split('/').at(-1).slice(3, -4);
        const departure = countries[1].src.split('/').at(-1).slice(3, -4);

        const dest_loc = locations[destination];
        const dep_loc = locations[departure];

        if (!dest_loc) {
            console.warn(`Destination ${destination} not found`);
            return
        }

        if (!dep_loc) {
            console.warn(`Departure ${departure} not found`);
            return
        }

        // Convert to lat/lon
        const depLatLon = mapToLatLon(dep_loc.x, dep_loc.y);
        const destLatLon = mapToLatLon(dest_loc.x, dest_loc.y);

        // Generate great circle path
        const pathPoints = greatCirclePath(depLatLon, destLatLon, 100);

        // Draw the curved path
        ctx.strokeStyle = '#FF0000AA';
        ctx.lineWidth = 2;
        ctx.beginPath();

        pathPoints.forEach((point, i) => {
            const mapCoords = latLonToMap(point.lat, point.lon);
            const real_x = canvas.width / 100 * mapCoords.x;
            const real_y = canvas.height / 100 * mapCoords.y;

            if (i === 0) {
                ctx.moveTo(real_x, real_y);
            } else {
                ctx.lineTo(real_x, real_y);
            }
        });

        ctx.stroke();

        // Find plane position along the great circle path
        const pathIndex = Math.floor((flight_percentage / 100) * (pathPoints.length - 1));
        const planeLatLon = pathPoints[pathIndex];
        const planeMapCoords = latLonToMap(planeLatLon.lat, planeLatLon.lon);

        const plane_x = canvas.width / 100 * planeMapCoords.x;
        const plane_y = canvas.height / 100 * planeMapCoords.y;

        // Calculate rotation based on tangent to the path
        let angle_rad = 0;
        if (pathIndex < pathPoints.length - 1) {
            const nextPoint = pathPoints[pathIndex + 1];
            const nextMapCoords = latLonToMap(nextPoint.lat, nextPoint.lon);

            const next_x = canvas.width / 100 * nextMapCoords.x;
            const next_y = canvas.height / 100 * nextMapCoords.y;

            angle_rad = Math.atan2(next_y - plane_y, next_x - plane_x);
        }

        const angle_deg = angle_rad * (180 / Math.PI);

        // Update plane position and rotation
        const plane = document.getElementById("plane-indicator");
        if (plane) {
            plane.style.left = `${plane_x - 16}px`;
            plane.style.top = `${plane_y - 16}px`;
            plane.style.transform = `rotate(${angle_deg}deg)`;
        }
    }

    const create_live_location_map = () => {
        const root = document.createElement("div");
        root.id = "travel-location-map"

        root.style.height = '400px';
        root.style.position = 'relative';
        root.style.background = 'url("https://github.com/justlucdewit/tampermonkey/blob/main/torn/live-location-travel-map/assets/map.png?raw=true")';
        root.style.backgroundSize = 'cover';

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext('2d');
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        const map_location_indicator_plane = document.createElement("div");
        map_location_indicator_plane.style.width = "32px";
        map_location_indicator_plane.style.height = "32px";
        map_location_indicator_plane.style.position = "absolute";
        map_location_indicator_plane.style.left = "0px";
        map_location_indicator_plane.style.top = "0px";
        map_location_indicator_plane.innerText = "✈︎"
        map_location_indicator_plane.style.color = "#F00";
        map_location_indicator_plane.style.display = "flex";
        map_location_indicator_plane.style.alignItems = "center";
        map_location_indicator_plane.style.justifyContent = "center";
        map_location_indicator_plane.style.fontSize = "32px";
        map_location_indicator_plane.id = "plane-indicator";
        map_location_indicator_plane.style.transformOrigin = "center center";

        setInterval(() => {
            render_frame(canvas, ctx);
        }, 1000);
        render_frame(canvas, ctx);

        root.appendChild(canvas);
        root.appendChild(map_location_indicator_plane);

        return root;
    }

    const initalize = () => {
        const travel_root = document.getElementById('travel-root');
        const random_fact_box = travel_root.querySelector('div[class^="randomFactWrapper"]');
        const original_flight_animation = travel_root.querySelector("figure");

        if (!(random_fact_box && original_flight_animation)) {
            return false;
        }

        const location_map = create_live_location_map();
        random_fact_box.remove();
        original_flight_animation.replaceWith(location_map);

        return true;
    }

    const attempt_initialization = () => {
        const result = initalize();

        if (!result) {
            requestAnimationFrame(attempt_initialization);
        }
    }

    requestAnimationFrame(attempt_initialization);
})();
