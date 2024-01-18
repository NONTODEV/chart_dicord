import { Injectable, OnModuleInit } from '@nestjs/common';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { MongoClient, Db, WithId } from 'mongodb';
import { ChartConfiguration } from 'chart.js';
import { mongodb } from 'config.json';



interface SubTotalData {
  device: string;
  time: string;
}

export interface UserData {
  discordName: string;
  serverName: string;
  subTotal: SubTotalData[];
  totalTime: string;
  sPeakingTime: string[];
}

@Injectable()
export class ChartService implements OnModuleInit {
  private static chartJSNodeCanvas: ChartJSNodeCanvas | null = null;

  async onModuleInit() {
    await this.ensureChartInitialized();
  }

  private async ensureChartInitialized(): Promise<void> {
    if (!ChartService.chartJSNodeCanvas) {
      ChartService.chartJSNodeCanvas = new ChartJSNodeCanvas({
        width: 1000,
        height: 600,
        chartCallback: async (ChartJS) => {
          if (typeof ChartJS !== 'undefined') {
            // Set up any chart plugins or options here if needed
          }
        },
      });
    }
  }

  async getDataFromMongo(): Promise<UserData[]> {
    const client = new MongoClient(mongodb, {});
    await client.connect();
    const database: Db = client.db('FH_Bot');
    const collection = database.collection<WithId<UserData>>('cronusertotaltimes');

    const result = await collection.find({}).toArray();
    console.log(result);

    client.close();
    return result;
  }

  private calculateTotalHours(sPeakingTime: string[]): number {
    return sPeakingTime.reduce((total, time) => {
      const hours = this.parseTotalTimeToHours(time);
      return total + hours;
    }, 0);
  }

  private parseTotalTimeToHours(totalTime: string): number {
    const parts = totalTime.split(', ').map((part) => {
      const [value, unit] = part.split(' ');
      return { value: parseInt(value), unit };
    });

    const totalHours = parts.reduce((acc, part) => {
      if (part && part.unit) {
        if (part.unit.includes('hour')) {
          return acc + part.value;
        } else if (part.unit.includes('minute')) {
          return acc + part.value / 60;
        } else if (part.unit.includes('second')) {
          return acc + part.value / 3600;
        }
      }
      return acc;
    }, 0);

    return totalHours;
  }

  createChartConfiguration(data: UserData[]): ChartConfiguration {
    const chartData: { [key: string]: { totalTime: number; sPeakingTime: number } } = {};

    data.forEach((item) => {
      if (item.totalTime) {
        const totalHours = this.parseTotalTimeToHours(item.totalTime);
        const sPeakingHours = this.calculateTotalHours(item.sPeakingTime);
        const label = `${item.discordName} - ${item.serverName}`;
        chartData[label] = { totalTime: totalHours, sPeakingTime: sPeakingHours };
      }
    });

    const labels = Object.keys(chartData);
    const dataValuesTotalTime = labels.map((label) => chartData[label].totalTime);
    const dataValuesSPeakingTime = labels.map((label) => chartData[label].sPeakingTime);

    const configuration: ChartConfiguration = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Total Time (Hours)',
            data: dataValuesTotalTime,
            type: 'bar',
            backgroundColor: 'rgba(245, 100, 175, 0.8)',
            borderColor: 'rgba(37, 36, 37, 0.8)',
            borderWidth: 1,
          },
          {
            label: 'Speaking Time (Hours)',
            data: dataValuesSPeakingTime,
            type: 'bar',
            backgroundColor: 'rgba(255, 204, 46, 0.8)',
            borderColor: 'rgba(37, 36, 37, 0.8)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        plugins: {
          datalabels: {
            anchor: 'end',
            align: 'top',
            formatter: (value, context) => {
              const datasetIndex = context.datasetIndex;
              const label = labels[datasetIndex];
              return `Total Time: ${chartData[label].totalTime.toFixed(2)} hours`;
            },
            display: 'auto',
          },
        } as ChartConfiguration['options']['plugins'],
        scales: {
          x: {
            type: 'category',
            position: 'bottom',
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Hours',
            },
          },
        },
      },
    };

    configuration.data.datasets.forEach((dataset, index) => {
      const label = labels[index];
      const text = `Total Time: ${chartData[label].totalTime.toFixed(2)} hours`;
      // @ts-ignore
      dataset.datalabels = { text: text };
    });
    return configuration;
  }

  async generateChart(configuration: ChartConfiguration): Promise<Buffer> {
    return await ChartService.chartJSNodeCanvas!.renderToBuffer(configuration);
  }

  async generateChartForUser(userData: UserData): Promise<Buffer> {
    return await this.generateChart(this.createChartConfiguration([userData]));
  }

  async generateChartFromMongoData(): Promise<Buffer> {
    await this.ensureChartInitialized();
    const dataFromMongo = await this.getDataFromMongo();
    const chartConfig: ChartConfiguration = this.createChartConfiguration(dataFromMongo);
    return await this.generateChart(chartConfig);
  }
}
