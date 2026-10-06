import { useState, useMemo } from 'react';
import { Row, Col, Button, InputGroup } from 'react-bootstrap';
import { TitleCard, AdapterEndpoint } from '@dssg/odin-react';
import type { ParamTree, ParamNode } from '@dssg/odin-react';
import ResizeableOdinGraph from '../ResizeableOdinGraph';

interface MonitorGraphProps {
  endpoint: AdapterEndpoint;
  title: string;
  paths: string[]; // paths to the data in the endpoint, e.g. "temperature_upper/data"
  seriesNames: string[];
  plotTitle?: string;
  xData?: number[];
  xLabel?: string;
  yLabel?: string;
  axisLimit?: [number, number];
  type?: string;
  showTitleCard?: boolean;
}

function MonitorGraph(props: MonitorGraphProps) {
    const {
      endpoint,
      title,
      paths,
      seriesNames,
      plotTitle = '',
      xData,
      xLabel,
      yLabel,
      axisLimit,
      type = 'scatter',
      showTitleCard = true
    } = props;

    // Initialise enabled traces outside of useEffect, all to true
    const [enabledTraces, setEnabledTraces] = useState(() =>
      Object.fromEntries(paths.map((_, i) => [i, true]))
    ); // Which traces should be shown

    // Look over endpoint.data and follow the paths down it to get the current data
    const data = useMemo(() => {
      if (!endpoint?.data) return paths.map(() => []); // same length as paths
      return paths.map((path) => {
        const val = path
          .split("/")
          // Narrow acc to paramnode|undefined for typing reasons
          .reduce<ParamTree | undefined>((acc, key) => {
            if (!acc || typeof acc !== 'object' || Array.isArray(acc)) return undefined;
            return (acc as ParamNode)[key];
          }, endpoint.data as ParamNode)
        return Array.isArray(val) && val.every((item): item is number => typeof item === 'number')
          ? val
          : [];
      });
    }, [paths, endpoint?.data]);

    // Filter out any data or names that aren't enabled at that index
    const filteredData = useMemo(() => 
      data.filter((_, i) => enabledTraces[i]), [data, enabledTraces]);

    const filteredNames = useMemo(() =>
      seriesNames.filter((_, i) => enabledTraces[i]), [seriesNames, enabledTraces]);

    // Copy the previous enabledTraces, flip the value for the specific trace
    const toggleTrace = (i: number) =>
      setEnabledTraces((prev) => ({...prev, [i]: !prev[i]}));

    // console.log(filteredData)

    const graphContent = (
        <Col>
          <Row>
            <Col style={{flexDirection: 'row', justifyContent: 'flex-end'}}>
              <InputGroup>
                <InputGroup.Text>
                  Toggle Traces
                </InputGroup.Text>
                {seriesNames.map((name, index) => (
                  <Button
                    key={index}
                    variant={enabledTraces[index] ? 'outline-primary' : 'outline-secondary'}
                    onClick={() => toggleTrace(index)}>
                      {enabledTraces[index] ? `Disable ${name}` : `Enable ${name}`}
                  </Button>
                ))}
              </InputGroup>
            </Col>
          </Row>
          <Row>
            <ResizeableOdinGraph
              title={plotTitle}
              prop_data={filteredData}
              x_data={xData}
              series_names={filteredNames}
              x_label={xLabel}
              y_label={yLabel}
              axis_limit={axisLimit}
              type={type}
              width={'99%'}
              responsive={false}
            />
          </Row>
        </Col>
    )

    return showTitleCard ? <TitleCard title={title}>{graphContent}</TitleCard> : graphContent;
}

export default MonitorGraph;