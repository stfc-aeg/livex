"""Python class to manage the inferencing endpoints (results, image)."""

import logging
import os
import time

import zmq
from zmq import ZMQError
from tornado.escape import json_decode
from odin_control.adapters.parameter_tree import ParameterTree
from odin_data.control.ipc_channel import IpcChannel
from odin_data.control.ipc_message import IpcMessage

from livex.util import LiveXError

class EndpointManager():

    def __init__(self, endpoint, name, data_retention):
        """Initialise the endpoint manager class.
        Create a range of variables for managing the connections and results,
        and create the ParameterTree after attempting to connect to a results endpoint.
        """
        self.endpoint_addr = endpoint
        self.results_endpoint = self.endpoint_addr + ":9002"
        self.image_endpoint = self.endpoint_addr + ":9003"
        self.image_channel = None
        self.image_header = None
        self.image = None
        self.name = name
        self.data_retention = data_retention

        self.msg_id = 0
        self.results = {}
        self.stats = {}
        self.model_status = {'app_state': 'no_model'}
        self.inferencing_path = None
        self.selected_model = None
        self.available_models = []
        self.result_modes = None
        self.bitmap_images = {}

        self.results_connected = False
        self.image_connected = False
        self.timeout_ms = 1000
        self.error_consecutive = 0

        self.flatfield_mode = 'first_n'
        self.flatfield_enabled = False
        self.flatfield_loaded = False
        self.flatfield_source = None
        self.flatfield_search_folder = None
        self.flatfield_state = 'none'
        self.flatfield_shape = None
        self.flatfield_capture = None
        self.flatfield_ticket = None
        self.flatfield_error = None
        self.flatfield_n = 10
        self.flatfield_number = 0
        self.flatfield_initialized = False
        self.flatfield_initialization_pending_disable = False
        self.framesets_path = None

        self._connect_results()
        self.tree = {
            'endpoint_name': self.name,
            'endpoint': self.endpoint_addr,
            'connection': {
                'results_connected': (lambda: self.results_connected, None),
                'image_connected': (lambda: self.image_connected, None),
                'reconnect': (lambda: None, self._connect_results)
            },
            'stats': (lambda: self.stats, None),
            'model': {
                'selected': (lambda: self.selected_model, None),
                'select': (lambda: self.selected_model, self.select_model),
                'status': (lambda: self.model_status, None),
                'available': (lambda: self.available_models, None)
            },
            'flatfield': {
                'enabled': (lambda: self.flatfield_enabled, self.set_flatfield_enabled),
                'loaded': (lambda: self.flatfield_loaded, None),
                'source': (lambda: self.flatfield_source, None),
                'search_folder': (lambda: self.flatfield_search_folder, None),
                'state': (lambda: self.flatfield_state, None),
                'shape': (lambda: self.flatfield_shape, None),
                'capture': (lambda: self.flatfield_capture, None),
                'mode': (lambda: self.flatfield_mode, None),
                'error': (lambda: self.flatfield_error, None),
                'n': (lambda: self.flatfield_n, self.set_flatfield_n, {'min': 1}),
                'number': (lambda: self.flatfield_number, self.set_flatfield_number, {'min': 0}),
            },
            'results': (lambda: self.results, None),
        }
        self.param_tree = ParameterTree(self.tree)

    def _connect_results(self, value=None):
        """Connect to the results endpoint.
        If it's available, fetch results.
        If there is a model loaded, populate the results part of the tree.
        """
        self.results_channel = IpcChannel(IpcChannel.CHANNEL_TYPE_DEALER)
        try:
            self.results_channel.connect(self.results_endpoint)
            self.results_connected = True
        except ZMQError as e:
            raise LiveXError(f"Error connecting to {self.name} results endpoint: {e}")

        # Get state once connection is established
        try:
            self.get_stats()
            self.list_models()

            # There may be a model loaded already
            if self.model_status['app_state'] != 'no_model':
                self.get_model_status()
                self._clear_results()

        except Exception as e:
            # If something goes wrong here try connecting another time, shouldn't hang the software
            logging.warning(f"Error getting initial stats/status from {self.name} results endpoint: {e}")
            logging.warning("Please call reconnect to try again.")
            self.results_connected = False

    def _connect_image(self):
        """Connect and subscribe to the image endpoint."""
        self.image_channel = IpcChannel(IpcChannel.CHANNEL_TYPE_SUB)
        try:
            self.image_channel.connect(self.image_endpoint)
            self.image_channel.subscribe()
        except ZMQError as e:
            self.image_channel.close()
            logging.warning("Error connecting to %s image endpoint: %s", self.name, e)
            return

        self.image_connected = True

    def _update_image_connection(self, image_stream):
        """Handle the image connection process."""
        endpoint = image_stream.get('endpoint') if image_stream.get('available') else None
        if endpoint == self.image_endpoint and (endpoint is None or self.image_connected):
            return

        self._close_image_connection()
        if endpoint:
            self._connect_image()

    def _close_image_connection(self):
        """Close the image connection and reset the local references."""
        if self.image_channel is not None:
            self.image_channel.close()
        self.image_connected = False
        self.image_header = None
        self.image = None
        self.bitmap_images.clear()

    def _call(self, cmd, params=None, timeout=1000):
        """Send an IPC command and return its response body."""
        self.msg_id += 1
        req = IpcMessage("cmd", cmd, id=self.msg_id)
        if params:
            req.set_params(params)
        self.results_channel.send(req.encode())
        if not (self.results_channel.poll(timeout) & IpcChannel.POLLIN):
            raise LiveXError(f"Timeout on inference command: {cmd}")
        response = IpcMessage(from_str=self.results_channel.recv())
        response_attrs = response.attrs

        if response_attrs.get('msg_type') == 'nack':
            body = next(iter(response_attrs.get('params', {}).values()), {})
            raise LiveXError(body.get('error', f"Inference command failed: {cmd}"))

        response_params = response_attrs.get('params', {})
        if self.name in response_params:
            return response_params[self.name]
        if len(response_params) == 1:
            return next(iter(response_params.values()))
        raise LiveXError(f"Unexpected response from inference command: {cmd}")

    def get_stats(self):
        """Get the endpoint stats and update the app state"""
        response = self._call(cmd='get_stats')
        logging.warning(f"get_stats response:\n{response}")
        self.stats = response.get('stats', {})  # Just the frame counters needed
        self.model_status['app_state'] = response.get(
            'app_state', self.model_status.get('app_state', 'no_model')
        )

        preprocess = response.get('preprocess', []) or []
        for process in preprocess:
            if process.get('name') == 'flatfield':
                self._update_flatfield_status(process)

        if (
            self.flatfield_initialization_pending_disable
            and self.flatfield_state != 'capturing'
        ):
            self.set_flatfield_enabled(False)
            self.flatfield_initialization_pending_disable = False

        if (
            not self.flatfield_initialized
            and self.model_status['app_state'] == 'ready'
        ):
            self._initialize_flatfield()

        return self.stats

    def _update_flatfield_status(self, status):
        self.flatfield_enabled = status.get('enabled', self.flatfield_enabled)
        self.flatfield_loaded = status.get('loaded', self.flatfield_loaded)
        self.flatfield_source = status.get('source', self.flatfield_source)
        self.flatfield_search_folder = status.get(
            'search_folder', self.flatfield_search_folder
        )
        self.flatfield_state = status.get('state', self.flatfield_state)
        self.flatfield_shape = status.get('shape', self.flatfield_shape)
        self.flatfield_capture = status.get('capture', self.flatfield_capture)
        self.flatfield_ticket = status.get('ticket')
        self.flatfield_error = status.get('error')

    def _update_flatfield_response(self, response):
        status = response.get('flatfield')
        if status is None:
            status = next(
                (process for process in response.get('preprocess', [])
                 if process.get('name') == 'flatfield'),
                None
            )
        if status is not None:
            self._update_flatfield_status(status)

    def _set_flatfield_spec(self, spec):
        if self.flatfield_enabled:
            self.set_flatfield_enabled(False)
        response = self._call(cmd='set_flatfield', params=spec)
        self._update_flatfield_response(response)
        self.flatfield_mode = 'first_n' if spec['source'] == 'first_n' else 'number'

    def _initialize_flatfield(self):
        self.flatfield_initialized = True
        self.flatfield_initialization_pending_disable = True
        try:
            self.set_flatfield_n(10)
        except Exception:
            self.flatfield_initialized = False
            self.flatfield_initialization_pending_disable = False
            raise

    def set_flatfield_n(self, value):
        """Set the first-N flat-field frame count."""
        try:
            frame_count = int(value)
        except (TypeError, ValueError) as error:
            raise LiveXError('Flat-field frame count must be an integer') from error
        if frame_count < 1:
            raise LiveXError('Flat-field frame count must be greater than zero')
        self._set_flatfield_spec({'source': 'first_n', 'n': frame_count})
        self.flatfield_n = frame_count

    def set_flatfield_number(self, value):
        """Resolve and load the flat-field file associated with an experiment number."""
        experiment_number = int(value)
        self._set_flatfield_spec({'source': 'number', 'num': experiment_number})
        self.flatfield_number = experiment_number

    def configure_storage(self, framesets_path, inferencing_path):
        """Configure flat-field lookup and inference output paths from LiveX."""
        self.framesets_path = framesets_path
        self.inferencing_path = inferencing_path
        response = self._call(
            cmd='set_flatfield_folder', params={'folder': framesets_path}
        )
        self.flatfield_search_folder = response.get('search_folder')

    def set_flatfield_enabled(self, enabled):
        """Toggle flat-field correction without discarding the loaded flat."""
        enabled = bool(enabled)
        response = self._call(
            cmd='set_preproc_param',
            params={'name': 'flatfield', 'key': 'enabled', 'value': enabled}
        )
        self._update_flatfield_response(response)

    def start_acquisition(self, acquisition_number, experiment_id):
        """Start inference recording with acquisition-owned paths and flat-field settings."""
        if not self.inferencing_path:
            raise LiveXError('Inferencing output path is not configured')
        self._call(
            cmd='set_hdf5_output',
            params={'out_dir': self.inferencing_path, 'prefix': experiment_id}
        )
        self._call(
            cmd='start_acquisition',
            params={
                'number': int(acquisition_number),
                'arm_hdf5': True
            }
        )

    def stop_acquisition(self):
        """Stop inference recording for the active acquisition."""
        self._call(cmd='stop_acquisition')

    def list_models(self):
        response = self._call('list_models')
        self.models = response['models']
        self.available_models = [
            {'name': model['name'], 'display_name': model['display_name']}
            for model in response['models']
        ]

    def select_model(self, name):
        """Request an asynchronous model selection by model folder name."""
        if not isinstance(name, str) or not name.strip():
            raise LiveXError('A model name is required')

        selected_model = name.strip()
        if not any(model['name'] == selected_model for model in self.models):
            raise LiveXError(f'Model name {selected_model} not found.')

        response = self._call(cmd='select_model', params={'name': selected_model})
        self.selected_model = response.get('name', name.strip())
        self.model_status = response

        self.result_modes = None
        self._clear_results()
        time.sleep(6)
        self.get_model_status()
        self.get_stats()

    def _clear_results(self):
        """Create an empty results tree based on the current model's result_modes."""
        result_modes = self.result_modes
        self.results = {'first_frame': 0, 'most_recent_frame': 0}
        self.bitmap_images.clear()
        if result_modes is None:
            return

        # Result modes describe each graph and the series available to plot.
        for graph_name, graph in result_modes.items():
            self.results[graph_name] = {
                'type': graph['type'],
                'axis_limit': graph.get('axis_limit'),
                'x_label': graph.get('x_label'),
                'y_label': graph.get('y_label'),
                'graph_label': graph.get('graph_label'),
                'results': {}
            }

            if graph['type'] != 'bitmap':
                self.results[graph_name]['frame_number'] = []
                for result in graph.get('results', []):
                    self.results[graph_name]['results'][result['name']] = {
                        'label': result.get('label', result['name']),
                        'data': [],
                    }

    def get_model_status(self):
        """Send a command to get the latest model status information."""
        response = self._call(cmd='get_model_status')
        self.model_status = {
            'app_state': response.get('app_state', self.model_status.get('app_state', 'no_model')),
            'display_name': response.get('display_name', self.model_status.get('display_name', None)),
            'preprocessing': response.get('preprocessing', self.model_status.get('preprocessing', None)),
            'image_stream': response.get('image_stream', {'available': False})
        }
        self.selected_model = response.get('selected', self.selected_model)
        result_modes = response.get('result_modes')
        if result_modes is not None and result_modes != self.result_modes:
            self.result_modes = result_modes
            self._clear_results()

        self._update_image_connection(self.model_status['image_stream'])

    def get_results(self):
        """Drain and store results currently buffered by the endpoint."""
        response = self._call(cmd='get_results')

        results = response.get('results', [])
        frame_number = None
        for inferred_frame in results:  # Results is an array of objects
            frame_number = inferred_frame['frame_number']
            for graph_name, results in inferred_frame['values'].items():
                for result, value in results.items():
                    if len(self.results[graph_name]['results'][result]['data']) >= self.data_retention:
                        self.results[graph_name]['results'][result]['data'].pop(0)
                    self.results[graph_name]['results'][result]['data'].append(
                        value
                    )

                frame_numbers = self.results[graph_name]['frame_number']
                if len(frame_numbers) >= self.data_retention:
                    frame_numbers.pop(0)
                frame_numbers.append(frame_number)

        self.results['most_recent_frame'] = frame_number

    def get_image(self):
        """Receive available image messages and retain the newest encoded image."""
        if not self.image_connected:
            return self.image

        latest_parts = None
        while True:
            try:
                parts = self.image_channel.socket.recv_multipart(flags=zmq.NOBLOCK)
            except zmq.Again:
                break
            if len(parts) == 2:
                latest_parts = parts

        if latest_parts is not None:
            header = json_decode(latest_parts[0])

            self.image = latest_parts[1]
            content_type = {'jpeg': 'image/jpeg', 'png': 'image/png'}.get(
                header.get('dtype')
            )
            if content_type is None:
                logging.warning(f"Unsupported image format from {self.name}: {self.header}")
                return self.image

            for graph in self.results.values():
                if isinstance(graph, dict) and graph.get('type') == 'bitmap':
                    graph['frame_number'] = header.get('frame_num')

            bitmap_graphs = [
                graph_name for graph_name, graph in self.results.items()
                if isinstance(graph, dict) and graph.get('type') == 'bitmap'
            ]
            if len(bitmap_graphs) == 1:
                self.bitmap_images[bitmap_graphs[0]] = (self.image, content_type)
            elif bitmap_graphs:
                logging.warning(
                    "Cannot associate image from %s with multiple bitmap graphs: %s",
                    self.name, bitmap_graphs
                )

        return self.image

    def get_bitmap_image(self, graph_name):
        """Return the latest encoded image and content type for a bitmap graph."""
        graph = self.results.get(graph_name)
        if not isinstance(graph, dict) or graph.get('type') != 'bitmap':
            return None
        return self.bitmap_images.get(graph_name)

    def _close_connection(self):
        """Close the control and image channels."""
        self._close_image_connection()
        if self.results_connected:
            self.results_channel.close()
            self.results_connected = False

    def _periodic_results_task(self):
        """Periodic task called by the controller to get model results if ready."""
        if not self.results_connected:
            return

        self.get_model_status()
        self.get_stats()
        if self.model_status['app_state'] in ['ready', 'capturing_flat', 'inferencing']:
            self.get_results()
        if self.image_connected:
            self.get_image()